export interface InstitutionDTO {
  id: string;
  name: string;
  bic?: string;
}

export interface ConnectResponse {
  id: string;
  link: string;
}

export interface FinalizeResponse {
  accounts: number;
}

export interface SyncResult {
  accountId: string;
  added: number;
  skipped: boolean;
  message?: string;
}

export interface BalanceDTO {
  accountId: string;
  type: string;
  amount: string;
  currency: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface MonthlyTotal {
  month: string; // YYYY-MM
  spent: number;
  received: number;
}

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

export interface DashboardDTO {
  balances: BalanceDTO[];
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
  topMerchants: MerchantTotal[];
}

export interface TransactionDTO {
  id: string;
  accountId: string;
  bookingDate: string | null;
  amount: string;
  currency: string;
  name: string | null; // creditor/debtor/merchant best-effort
  remittanceInfo: string | null;
  category: string;
  status: string;
}
