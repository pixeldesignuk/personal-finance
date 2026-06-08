import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../env.ts";
import type { ParsedExpense } from "../lib/cashTxn.ts";

const ExpenseSchema = z.object({
  amount: z.number(),
  category: z.enum(["groceries", "eating-out", "transport", "bills", "shopping", "other", "income", "transfer"]),
  merchant: z.string(),
  date: z.string(),
});

const SYSTEM =
  "Extract a single cash expense from the user's message or receipt photo. " +
  "amount: the total as a number, NEGATIVE for spending and positive only for income. " +
  "category: best fit from the allowed set. merchant: short name/description. " +
  "date: YYYY-MM-DD if present, else empty string. Respond only via the schema.";

function client(): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

async function extract(content: Anthropic.MessageParam["content"]): Promise<ParsedExpense | null> {
  const res = await client().messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExpenseSchema) },
  });
  return (res.parsed_output as ParsedExpense | null) ?? null;
}

export function parseText(text: string): Promise<ParsedExpense | null> {
  return extract([{ type: "text", text }]);
}

export function parseImage(base64: string, mediaType: string, caption?: string): Promise<ParsedExpense | null> {
  const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)
    ? mediaType
    : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return extract([
    { type: "text", text: caption ? `Receipt. Note: ${caption}` : "Extract the expense from this receipt." },
    { type: "image", source: { type: "base64", media_type: media, data: base64 } },
  ]);
}
