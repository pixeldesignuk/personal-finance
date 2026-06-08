import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
  BudgetDTO, SummaryDTO, ManualAccountInput, ManualTxnInput,
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

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string) => send<ConnectResponse>("POST", "/api/connect", { institutionId }),
  finalize: (id: string) => send<FinalizeResponse>("POST", `/api/connect/${id}/finalize`),
  sync: () => send<SyncResult[]>("POST", "/api/sync"),
  accounts: () => get<BankDTO[]>("/api/accounts"),
  createManualAccount: (input: ManualAccountInput) => send<{ id: string }>("POST", "/api/accounts/manual", input),
  patchAccount: (id: string, patch: { nickname?: string | null; type?: string; name?: string; manualBalance?: string; balanceType?: string | null }) =>
    send<NicknameResult>("PATCH", `/api/accounts/${id}`, patch),
  deleteManualAccount: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/accounts/${id}`),
  removeBank: (requisitionId: string) => send<RemoveBankResult>("DELETE", `/api/banks/${requisitionId}`),
  createTxn: (input: ManualTxnInput) => send<{ id: string }>("POST", "/api/transactions", input),
  setTxnCategory: (id: string, category: string) => send<{ id: string; category: string }>("PATCH", `/api/transactions/${id}`, { category }),
  deleteTxn: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/transactions/${id}`),
  budgets: () => get<BudgetDTO[]>("/api/budgets"),
  setBudget: (category: string, monthlyLimit: number) => send<unknown>("PUT", `/api/budgets/${category}`, { monthlyLimit }),
  summary: () => get<SummaryDTO>("/api/summary"),
  dashboard: (accountId?: string) => { const q = acctQuery(accountId); return get<DashboardDTO>(`/api/dashboard${q ? `?${q}` : ""}`); },
  transactions: (search = "", accountId?: string) => {
    const parts = [`search=${encodeURIComponent(search)}`, acctQuery(accountId)].filter(Boolean);
    return get<TransactionDTO[]>(`/api/transactions?${parts.join("&")}`);
  },
};

export const CATEGORY_OPTIONS = ["groceries", "eating-out", "transport", "bills", "shopping", "other", "income", "transfer"];
