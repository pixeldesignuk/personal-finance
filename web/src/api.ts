import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, SyncRunDTO, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
  SummaryDTO, ManualAccountInput, ManualTxnInput,
  CategoryDTO, BudgetResponseDTO, CategoryInfoDTO, ReportDTO,
  PersonDTO, RuleDTO, CategoryNameDTO, ReconcileResult, AuditEvent, InvestmentsDTO, SettingsDTO, DebtsDTO, MerchantsDTO, AccountRecurringDTO, PotsDTO, PluginsDTO, EmailOrderDTO,
  RecurringScheduleDTO, UpcomingDTO,
} from "../../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
const acctQuery = (accountId?: string) =>
  accountId && accountId !== "all" ? `accountId=${encodeURIComponent(accountId)}` : "";

// POST that reads a newline-delimited JSON stream, calling onEvent per line.
async function streamNdjson(url: string, body: unknown, onEvent: (e: AuditEvent) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AuditEvent);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    flush(decoder.decode(value, { stream: true }));
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as AuditEvent);
}

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string, maxHistoricalDays?: number) =>
    send<ConnectResponse>("POST", "/api/connect", { institutionId, ...(maxHistoricalDays ? { maxHistoricalDays } : {}) }),
  finalize: (id: string) => send<FinalizeResponse>("POST", `/api/connect/${id}/finalize`),
  sync: () => send<SyncResult[]>("POST", "/api/sync"),
  syncRuns: () => get<SyncRunDTO[]>("/api/sync/runs"),
  accounts: () => get<BankDTO[]>("/api/accounts"),
  accountsRecurring: () => get<AccountRecurringDTO[]>("/api/accounts/recurring"),
  createManualAccount: (input: ManualAccountInput) => send<{ id: string }>("POST", "/api/accounts/manual", input),
  linkDebt: (id: string, debtAccountId: string) => send<{ linked: boolean }>("POST", `/api/transactions/${id}/link-debt`, { debtAccountId }),
  unlinkDebt: (id: string) => send<{ unlinked: boolean }>("POST", `/api/transactions/${id}/unlink-debt`),
  patchAccount: (id: string, patch: { nickname?: string | null; type?: string; name?: string; manualBalance?: string; excludedBalance?: string | null; balanceType?: string | null; interestRate?: string | null; priority?: number | null; targetPayment?: string | null; debtExcluded?: boolean }) =>
    send<NicknameResult>("PATCH", `/api/accounts/${id}`, patch),
  deleteManualAccount: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/accounts/${id}`),
  removeBank: (requisitionId: string) => send<RemoveBankResult>("DELETE", `/api/banks/${requisitionId}`),
  createTxn: (input: ManualTxnInput) => send<{ id: string }>("POST", "/api/transactions", input),
  setTxnCategory: (id: string, category: string) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { category }),
  setTxnPerson: (id: string, personKey: string | null) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { personKey }),
  setTxnNote: (id: string, note: string | null) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { note }),
  setTxnFlag: (id: string, flag: "red" | "orange" | "yellow" | null) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { flag }),
  bulkCategory: (ids: string[], category: string) => send<{ updated: number }>("POST", "/api/transactions/bulk-category", { ids, category }),
  applyToMatching: (id: string, fields: ("category" | "person")[]) =>
    send<{ matched: number; applied: string[]; token: string }>("POST", `/api/transactions/${id}/apply-to-matching`, { fields }),
  deleteTxn: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/transactions/${id}`),
  categories: () => get<CategoryDTO[]>("/api/categories"),
  budget: (month?: string, person?: string) => {
    const parts = [month ? `month=${month}` : "", person ? `person=${encodeURIComponent(person)}` : ""].filter(Boolean);
    return get<BudgetResponseDTO>(`/api/budget${parts.length ? `?${parts.join("&")}` : ""}`);
  },
  autoPopulateBudget: () => send<{ updated: number; months: number; total: number }>("POST", "/api/budget/auto-populate"),
  report: (month?: string) => get<ReportDTO>(`/api/reports${month ? `?month=${month}` : ""}`),
  categoryInfo: (key: string, month?: string, person?: string) => {
    const parts = [month ? `month=${month}` : "", person ? `person=${encodeURIComponent(person)}` : ""].filter(Boolean);
    return get<CategoryInfoDTO>(`/api/budget/category/${encodeURIComponent(key)}${parts.length ? `?${parts.join("&")}` : ""}`);
  },
  categoryNames: () => get<CategoryNameDTO[]>("/api/category-names"),
  people: () => get<PersonDTO[]>("/api/people"),
  createPerson: (name: string) => send<{ id: number; key: string }>("POST", "/api/people", { name }),
  patchPerson: (id: number, patch: { name?: string; sortOrder?: number; archived?: boolean }) => send<{ id: number }>("PATCH", `/api/people/${id}`, patch),
  deletePerson: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/people/${id}`),
  rules: () => get<RuleDTO[]>("/api/rules"),
  createRule: (input: { matchText: string; categoryKey?: string | null; personKey?: string | null; priority?: number }) => send<{ id: number }>("POST", "/api/rules", input),
  patchRule: (id: number, input: { matchText: string; categoryKey?: string | null; personKey?: string | null; priority: number }) => send<{ id: number }>("PATCH", `/api/rules/${id}`, input),
  deleteRule: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/rules/${id}`),
  applyRules: () => send<{ categorised: number; personed: number }>("POST", "/api/rules/apply"),
  reconcile: () => send<ReconcileResult>("POST", "/api/reconcile"),
  // Streams audit events (NDJSON) as the pipeline runs; calls onEvent for each.
  reconcileStream: (onEvent: (e: AuditEvent) => void, accountId?: string) =>
    streamNdjson("/api/reconcile/stream", { accountId }, onEvent),
  syncStream: (onEvent: (e: AuditEvent) => void) => streamNdjson("/api/sync/stream", {}, onEvent),
  cleanseStream: (onEvent: (e: AuditEvent) => void) => streamNdjson("/api/cleanse/stream", {}, onEvent),
  createCategory: (input: { name: string; group?: string | null; monthlyAmount?: number }) =>
    send<{ id: number }>("POST", "/api/categories", input),
  patchCategory: (id: number, patch: { name?: string; group?: string | null; monthlyAmount?: number; sortOrder?: number; archived?: boolean }) =>
    send<{ id: number }>("PATCH", `/api/categories/${id}`, patch),
  deleteCategory: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/categories/${id}`),
  summary: () => get<SummaryDTO>("/api/summary"),
  debts: () => get<DebtsDTO>("/api/debts"),
  merchants: () => get<MerchantsDTO>("/api/merchants"),
  merchantOrders: (token: string) => get<EmailOrderDTO[]>(`/api/merchants/${encodeURIComponent(token)}/orders`),
  confirmDetectedMerchants: () => send<{ created: number }>("POST", "/api/merchants/confirm-detected"),
  patchMerchant: (token: string, patch: { name?: string | null; domain?: string | null; recurring?: "auto" | "fixed" | "variable" | "ignore"; categoryKey?: string | null; personKey?: string | null; priority?: number }) =>
    send<{ ok: boolean }>("PATCH", `/api/merchants/${encodeURIComponent(token)}`, patch),
  settings: () => get<SettingsDTO>("/api/settings"),
  patchSettings: (patch: Record<string, boolean>) => send<Record<string, boolean>>("PATCH", "/api/settings", patch),
  pots: () => get<PotsDTO>("/api/pots"),
  createPot: (input: { name: string; target?: number | null; emoji?: string | null; balance?: number }) => send<{ id: number }>("POST", "/api/pots", input),
  patchPot: (id: number, patch: { name?: string; target?: number | null; balance?: number; emoji?: string | null; note?: string | null; archived?: boolean }) => send<{ id: number }>("PATCH", `/api/pots/${id}`, patch),
  movePot: (id: number, amount: number) => send<{ id: number; balance: number }>("POST", `/api/pots/${id}/move`, { amount }),
  deletePot: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/pots/${id}`),
  recurring: () => get<RecurringScheduleDTO[]>("/api/recurring"),
  detectRecurring: () => send<{ detected: number }>("POST", "/api/recurring/detect"),
  createRecurring: (input: { name: string; direction: "out" | "in"; amount: number; dayOfMonth: number; cadence?: string; nextDue?: string }) =>
    send<RecurringScheduleDTO>("POST", "/api/recurring", input),
  patchRecurring: (token: string, patch: { status?: "auto" | "confirmed" | "ignored"; amount?: number; dayOfMonth?: number; cadence?: string; direction?: "out" | "in"; accountId?: string | null; nextDue?: string; name?: string }) =>
    send<RecurringScheduleDTO>("PATCH", `/api/recurring/${encodeURIComponent(token)}`, patch),
  notRecurring: (token: string) => send<{ ok: true }>("POST", `/api/recurring/${encodeURIComponent(token)}/not-recurring`),
  upcoming: (days = 30) => get<UpcomingDTO>(`/api/upcoming?days=${days}`),
  plugins: () => get<PluginsDTO>("/api/plugins"),
  gmailOrders: (q = "", filter = "all") => get<EmailOrderDTO[]>(`/api/plugins/gmail/orders?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`),
  gmailSyncStream: (onEvent: (e: AuditEvent) => void) => streamNdjson("/api/plugins/gmail/sync/stream", {}, onEvent),
  disconnectGmail: () => send<{ ok: boolean }>("POST", "/api/plugins/gmail/disconnect"),
  registerTelegram: () => send<{ ok: boolean; url: string; description: string | null }>("POST", "/api/plugins/telegram/register"),
  investments: () => get<InvestmentsDTO>("/api/investments"),
  syncInvestment: (provider: string) => send<{ provider: string; total: number; holdings: number }>("POST", `/api/investments/${provider}/sync`),
  syncInvestments: () => send<{ results: { provider: string; total: number; holdings: number }[] }>("POST", "/api/investments/sync"),
  dashboard: (accountId?: string, month?: string) => {
    const parts = [acctQuery(accountId), month ? `month=${month}` : ""].filter(Boolean);
    return get<DashboardDTO>(`/api/dashboard${parts.length ? `?${parts.join("&")}` : ""}`);
  },
  transactions: (search = "", accountId?: string, person?: string, month?: string, merchant?: string) => {
    const parts = [`search=${encodeURIComponent(search)}`, acctQuery(accountId), person ? `person=${encodeURIComponent(person)}` : "", month ? `month=${month}` : "", merchant ? `merchant=${encodeURIComponent(merchant)}` : ""].filter(Boolean);
    return get<TransactionDTO[]>(`/api/transactions?${parts.join("&")}`);
  },
};
