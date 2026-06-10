import type { EmailOrderDTO } from "../../shared/types.ts";

interface Row {
  id: string;
  emailDate: Date | null;
  merchantName: string | null;
  total: { toString(): string } | null;
  currency: string | null;
  orderNumber: string | null;
  items: unknown;
  tags: unknown;
  isRefund: boolean;
  subject: string | null;
  transactionId: string | null;
  matched: boolean;
}

export function toEmailOrderDTO(o: Row): EmailOrderDTO {
  return {
    id: o.id,
    emailDate: o.emailDate?.toISOString() ?? null,
    merchantName: o.merchantName,
    total: o.total != null ? Number(o.total.toString()) : null,
    currency: o.currency,
    orderNumber: o.orderNumber,
    items: (o.items as unknown as EmailOrderDTO["items"]) ?? [],
    tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(String) : [],
    isRefund: o.isRefund,
    subject: o.subject,
    transactionId: o.transactionId,
    matched: o.matched,
  };
}

// Free-text match across merchant / order# / tags / item names / subject.
export function orderMatchesQuery(o: EmailOrderDTO, q: string): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  return (
    (o.merchantName ?? "").toLowerCase().includes(n) ||
    (o.orderNumber ?? "").toLowerCase().includes(n) ||
    (o.subject ?? "").toLowerCase().includes(n) ||
    o.tags.some((t) => t.includes(n)) ||
    o.items.some((i) => i.name.toLowerCase().includes(n))
  );
}
