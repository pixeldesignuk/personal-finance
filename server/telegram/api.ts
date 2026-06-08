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
