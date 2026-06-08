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
  name: string | null;
  remittanceInfo: string | null;
  category: string;      // effective
  autoCategory: string;  // auto-derived (before override)
  personKey: string | null;
  personName: string | null;
  source: AccountSource;
  status: string;
}

export interface AccountBalanceDTO {
  type: string;
  amount: string;
  currency: string;
}

export type AccountType = "PERSONAL" | "BUSINESS";
export type AccountSource = "BANK" | "MANUAL";

export interface AccountDTO {
  id: string;
  name: string | null;
  nickname: string | null;
  displayName: string;
  iban: string | null;
  currency: string | null;
  type: AccountType;
  source: AccountSource;
  currentBalance: number;
  balanceType: string | null;
  balances: AccountBalanceDTO[];
}

export interface BankDTO {
  requisitionId: string;
  institutionId: string;
  institutionName: string;
  status: string;
  accounts: AccountDTO[];
}

export interface RemoveBankResult {
  deleted: boolean;
  remoteDeleted: boolean;
}

export interface NicknameResult {
  id: string;
  displayName: string;
}

export interface SummaryDTO {
  month: string;
  netWorth: number;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export interface ManualAccountInput {
  name: string;
  type: AccountType;
  currency?: string;
  manualBalance?: string;
}

export interface ManualTxnInput {
  accountId: string;
  date: string;
  amount: string;
  category: string;
  note?: string;
}

export interface CategoryDTO {
  id: number;
  key: string;
  name: string;
  monthlyAmount: number;
  sortOrder: number;
  archived: boolean;
}

export interface BudgetRowDTO {
  key: string;
  name: string;
  budgeted: number;
  spent: number;
  left: number;
  percent: number;
}

export interface ReportRowDTO {
  categoryKey: string;
  name: string;
  total: number;
  byPerson: Record<string, number>;
}

export interface ReportDTO {
  month: string;
  summary: { income: number; expenses: number; net: number; savingsRate: number };
  rows: ReportRowDTO[];
  personTotals: Record<string, number>;
  grandTotal: number;
  people: { key: string; name: string }[];
}

export interface PersonDTO {
  id: number;
  key: string;
  name: string;
  sortOrder: number;
  archived: boolean;
}
export interface RuleDTO {
  id: number;
  matchText: string;
  categoryKey: string | null;
  personKey: string | null;
  priority: number;
  auto: boolean;
}

export interface ReconcileResult {
  total: number;       // transactions that were uncategorised at the start
  byRules: number;     // categorised by the free rules engine
  byLlm: number;       // categorised by Gemini Flash
  rulesLearned: number; // merchant rules auto-created from LLM picks
  llmSkipped: boolean; // true when no GEMINI_API_KEY is configured
}
export interface CategoryNameDTO {
  key: string;
  name: string;
}
