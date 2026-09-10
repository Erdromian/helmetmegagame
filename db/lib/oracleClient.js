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
// honest error otherwise. The caller (db/lib/turnSideEffects.js) wraps each call
// in step(), which is where the real durability lives.

const DEFAULT_TIMEOUT_MS = 180_000;

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
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    // A 200 with no content is a provider problem, not a prompt problem, and it
    // is the shape an overloaded gateway most often returns.
    throw new OracleError("The provider returned no text.", { retryable: true });
  }

  return {
    text: text.trim(),
    inputTokens: Number(json?.usage?.prompt_tokens) || null,
    outputTokens: Number(json?.usage?.completion_tokens) || null,
  };
}

// One completion. Throws OracleError; the caller decides what a failure means.
//
// `config` is a GameConfig row — the API key never travels any other way, so
// there is exactly one place in the codebase that reads it.
async function complete(config, { system, user, timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = 2048 }) {
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
    return await once(args);
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
    });
    return { ok: true, ms: Date.now() - started, reply: res.text.slice(0, 40) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.message ?? String(err) };
  }
}

module.exports = { complete, testConnection, OracleError, DEFAULT_TIMEOUT_MS };
