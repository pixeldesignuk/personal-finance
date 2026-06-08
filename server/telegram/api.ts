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

export async function downloadPhoto(fileId: string): Promise<{ base64: string; mediaType: string }> {
  const meta = (await call<{ result?: { file_path?: string } }>("getFile", { file_id: fileId })).result;
  const path = meta?.file_path;
  if (!path) throw new Error("Telegram getFile returned no path");
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { base64: buf.toString("base64"), mediaType };
}
