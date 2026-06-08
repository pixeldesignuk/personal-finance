import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
  SummaryDTO, ManualAccountInput, ManualTxnInput,
  CategoryDTO, BudgetRowDTO, ReportDTO,
  PersonDTO, RuleDTO, CategoryNameDTO, ReconcileResult,
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
  setTxnCategory: (id: string, category: string) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { category }),
  setTxnPerson: (id: string, personKey: string | null) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { personKey }),
  deleteTxn: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/transactions/${id}`),
  categories: () => get<CategoryDTO[]>("/api/categories"),
  budget: (month?: string, person?: string) => {
    const parts = [month ? `month=${month}` : "", person ? `person=${encodeURIComponent(person)}` : ""].filter(Boolean);
    return get<BudgetRowDTO[]>(`/api/budget${parts.length ? `?${parts.join("&")}` : ""}`);
  },
  report: (month?: string) => get<ReportDTO>(`/api/reports${month ? `?month=${month}` : ""}`),
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
  createCategory: (input: { name: string; monthlyAmount?: number }) =>
    send<{ id: number }>("POST", "/api/categories", input),
  patchCategory: (id: number, patch: { name?: string; monthlyAmount?: number; sortOrder?: number; archived?: boolean }) =>
    send<{ id: number }>("PATCH", `/api/categories/${id}`, patch),
  deleteCategory: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/categories/${id}`),
  summary: () => get<SummaryDTO>("/api/summary"),
  dashboard: (accountId?: string) => { const q = acctQuery(accountId); return get<DashboardDTO>(`/api/dashboard${q ? `?${q}` : ""}`); },
  transactions: (search = "", accountId?: string, person?: string) => {
    const parts = [`search=${encodeURIComponent(search)}`, acctQuery(accountId), person ? `person=${encodeURIComponent(person)}` : ""].filter(Boolean);
    return get<TransactionDTO[]>(`/api/transactions?${parts.join("&")}`);
  },
};
