import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
} from "../../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string) => post<ConnectResponse>("/api/connect", { institutionId }),
  finalize: (id: string) => post<FinalizeResponse>(`/api/connect/${id}/finalize`),
  sync: () => post<SyncResult[]>("/api/sync"),
  dashboard: () => get<DashboardDTO>("/api/dashboard"),
  transactions: (search = "") => get<TransactionDTO[]>(`/api/transactions?search=${encodeURIComponent(search)}`),
};
