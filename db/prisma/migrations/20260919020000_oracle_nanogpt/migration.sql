-- The Oracle points at NanoGPT rather than OpenRouter by default.
--
-- Both speak the same OpenAI-shaped /chat/completions, and NanoGPT carries the
-- same model under the same id (`deepseek/deepseek-v4-flash`, confirmed against
-- its public /v1/models list), so only the label and the URL move. The model
-- column is untouched.
ALTER TABLE "GameConfig" ALTER COLUMN "oracleProvider" SET DEFAULT 'nanogpt';
ALTER TABLE "GameConfig" ALTER COLUMN "oracleBaseUrl" SET DEFAULT 'https://nano-gpt.com/api/v1';

-- A DEFAULT only applies to new rows, and GameConfig is a singleton that
-- already exists — without this the panel would keep showing OpenRouter for
-- ever. Guarded on the old value so a hand-entered endpoint is never clobbered:
-- this moves the row only if nobody has touched it.
UPDATE "GameConfig"
   SET "oracleProvider" = 'nanogpt',
       "oracleBaseUrl"  = 'https://nano-gpt.com/api/v1'
 WHERE "oracleProvider" = 'openrouter'
   AND "oracleBaseUrl"  = 'https://openrouter.ai/api/v1';
