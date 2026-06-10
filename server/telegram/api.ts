import { env } from "../env.ts";

const base = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function call<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  return call("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

export function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup });
}

export function answerCallbackQuery(id: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: id, text });
}

export async function getWebhookInfo(): Promise<{ url?: string; pending_update_count?: number; last_error_message?: string } | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const r = await call<{ ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } }>("getWebhookInfo", {});
  return r.ok ? (r.result ?? null) : null;
}

export async function setWebhook(url: string, secret?: string): Promise<{ ok: boolean; description?: string }> {
  return call("setWebhook", { url, secret_token: secret || undefined, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
}

// Resolve a Telegram file_id to a downloadable path.
export async function getFilePath(fileId: string): Promise<string | null> {
  const r = await call<{ ok: boolean; result?: { file_path?: string } }>("getFile", { file_id: fileId });
  return r.result?.file_path ?? null;
}

// Download a Telegram file as base64 + its mime type (inferred from extension).
export async function downloadFile(filePath: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = filePath.toLowerCase();
  const mimeType = ext.endsWith(".png") ? "image/png" : ext.endsWith(".webp") ? "image/webp" : ext.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
  return { base64: buf.toString("base64"), mimeType };
}
