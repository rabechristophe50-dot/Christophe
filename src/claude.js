import Anthropic from "@anthropic-ai/sdk";

// Resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
const client = new Anthropic();

// Default to the most capable Claude model. Override with CLAUDE_MODEL if needed.
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// JSON schema the model must fill in. Structured outputs guarantee a parseable,
// schema-valid response so downstream execution logic never has to scrape prose.
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["buy", "sell", "hold", "close"],
      description: "The trading action to take.",
    },
    confidence: {
      type: "number",
      description: "Confidence in the action, from 0 (none) to 1 (certain).",
    },
    size_pct: {
      type: "number",
      description:
        "Suggested position size as a percentage (0-100) of available risk budget. 0 for hold.",
    },
    stop_loss: {
      type: "string",
      description: "Suggested stop-loss level, or 'none'.",
    },
    take_profit: {
      type: "string",
      description: "Suggested take-profit level, or 'none'.",
    },
    rationale: {
      type: "string",
      description: "One or two sentences explaining the decision.",
    },
  },
  required: [
    "action",
    "confidence",
    "size_pct",
    "stop_loss",
    "take_profit",
    "rationale",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a disciplined trading assistant. You receive raw alerts from
TradingView (indicators, strategy signals, price levels) and turn each into a single,
risk-aware decision. Be conservative: prefer "hold" when the signal is ambiguous, never
size above the caller's stated risk budget, and always attach a stop-loss for any entry.
You do not have live market access beyond the alert payload you are given — reason only
from that payload, the stated account context, and the trading rules you are given.
Treat the rules as hard constraints: never violate the risk limits, the symbol allowlist,
or the stop-loss requirement.`;

/**
 * Ask Claude to turn a TradingView alert into a structured trading decision.
 *
 * @param {object} alert       The raw alert payload from TradingView.
 * @param {object} [context]   Optional account context (balance, open positions, risk %).
 * @param {object} [rules]     Trading rules / hard constraints (from rules.json).
 * @returns {Promise<object>}  A decision matching DECISION_SCHEMA.
 */
export async function analyzeAlert(alert, context = {}, rules = {}) {
  const userContent = [
    "TradingView alert:",
    "```json",
    JSON.stringify(alert, null, 2),
    "```",
    "",
    "Account context:",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "Trading rules (hard constraints — do not violate):",
    "```json",
    JSON.stringify(rules, null, 2),
    "```",
    "",
    "Return a single trading decision for this alert.",
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: DECISION_SCHEMA },
    },
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to analyze this alert.");
  }

  // With output_config.format, the first text block is schema-valid JSON.
  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}
