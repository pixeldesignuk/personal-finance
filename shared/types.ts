export interface InstitutionDTO {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
}

export interface ConnectResponse {
  id: string;
  link: string;
}

export interface FinalizeResponse {
  accounts: number;
  rateLimited?: boolean; // bank's daily fetch limit was hit; history fills in on the next sync
}

export interface SyncResult {
  accountId: string;
  added: number;
  skipped: boolean;
  message?: string;
  newCount?: number; // transactions that didn't exist before this sync
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
  accountName: string;   // resolved display name, so the list is self-labelling
  bookingDate: string | null;
  amount: string;
  currency: string;
  name: string | null;
  remittanceInfo: string | null;
  category: string;      // effective
  autoCategory: string;  // auto-derived (before override)
  personKey: string | null;
  personName: string | null;
  note: string | null;   // user-editable annotation
  flag: "red" | "orange" | "yellow" | null;  // spend-reduction flag
  debtAccountId: string | null;  // linked liability (repayment)
  source: AccountSource;
  origin: "bank" | "telegram" | "receipt" | "manual"; // how it got here (upload method)
  status: string;
  order: { id: string; hasAttachment: boolean; merchant: string | null; total: number | null; currency: string | null; orderNumber: string | null; date: string | null; items: EmailOrderItem[] } | null; // matched email order / receipt (Gmail or Telegram)
}

export interface AccountBalanceDTO {
  type: string;
  amount: string;
  currency: string;
}

export type AccountType = "PERSONAL" | "BUSINESS";
export type AccountSource = "BANK" | "MANUAL" | "INVESTMENT" | "ASSET" | "LIABILITY";

export interface HoldingDTO {
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  pnl: number | null;
  currency: string | null;
}

export interface InvestmentAccountDTO {
  id: string;
  name: string;
  provider: string;
  currency: string;
  total: number;
  cash: number;
  invested: number;
  pnl: number;
  holdings: HoldingDTO[];
}

export interface MerchantDTO {
  token: string;
  name: string | null; // human-readable name layered on top (editable); null if unset
  domain: string | null; // brand domain for the logo (e.g. tesco.com), editable
  statement: string;   // raw bank statement line — immutable source of truth
  accountName: string | null; // the account/bank it's mostly paid from
  accountLogo: string | null; // that bank's logo URL (null for manual/cash)
  orderCount: number;         // matched Gmail orders for this merchant
  categoryKey: string | null; // category (from the linked rule, or most-common txn category)
  categoryFromRule: boolean;  // true = saved as a rule; false = auto-detected suggestion
  personKey: string | null;   // person (from the linked rule)
  priority: number;           // rule priority
  totalSpent: number;
  txnCount: number;
  monthsActive: number;
  monthlyTypical: number;   // fixed → median payment; variable → avg monthly spend
  lastDate: string | null;
  detected: "fixed" | "variable" | "oneoff";
  override: "auto" | "fixed" | "variable" | "ignore";
  effective: "fixed" | "variable" | "oneoff" | "ignore";
}
export interface MerchantsDTO {
  merchants: MerchantDTO[];
  monthlyOutgoings: number; // sum of fixed recurring (committed monthly)
  variableMonthly: number;  // avg monthly variable spend
}

export interface EmailOrderItem { name: string; qty: number | null; price: number | null }
export interface EmailOrderDTO {
  id: string;
  source: string;        // "gmail" | "telegram"
  emailDate: string | null;
  merchantName: string | null;
  total: number | null;
  currency: string | null;
  orderNumber: string | null;
  items: EmailOrderItem[];
  tags: string[];
  isRefund: boolean;
  subject: string | null;
  transactionId: string | null;
  matched: boolean;
  hasAttachment: boolean;   // an original document is stored (view via /api/orders/:id/file)
}

export interface SyncRunDTO {
  id: string;
  source: string;       // gmail | bank | investments | all
  status: string;       // running | ok | error
  startedAt: string;
  finishedAt: string | null;
  summary: unknown;     // per-source counts
  error: string | null;
}

export interface PluginsDTO {
  gmail: {
    available: boolean;   // GOOGLE_CLIENT_ID/SECRET configured
    connected: boolean;
    email: string | null;
    lastSyncAt: string | null;
    orders: number;       // total parsed email orders
    matched: number;      // those linked to a transaction
    realtime: boolean;    // Pub/Sub push configured (GMAIL_PUBSUB_TOPIC set)
    watchExpiry: string | null; // when the current push watch lapses
  };
  telegram: {
    available: boolean;   // TELEGRAM_BOT_TOKEN/KEY + WEBHOOK_SECRET + ALLOWED_CHAT_ID set
    connected: boolean;   // webhook registered with Telegram
    webhookUrl: string | null;
    receipts: number;     // receipts captured via the bot
  };
}

// A savings pot — earmarks part of existing liquid cash toward a goal.
export interface PotDTO {
  id: number;
  name: string;
  target: number | null;
  balance: number;
  emoji: string | null;
  note: string | null;
  sortOrder: number;
}
export interface PotsDTO {
  pots: PotDTO[];
  liquid: number;       // total cash across bank + manual accounts
  allocated: number;    // sum of all pot balances
  budgeted: number;     // this month's total budget (cash already earmarked for spending)
  available: number;    // liquid − budgeted − allocated (free to assign to pots)
  unallocated: number;  // liquid − allocated (negative = over-allocated)
}

// Per-account recurring outgoings → the balance to keep in that account monthly.
export interface AccountRecurringDTO {
  accountId: string;
  recurringMonthly: number;  // sum of fixed recurring payments leaving this account
  items: { name: string; monthly: number }[];  // the recurring merchants, biggest first
}

// A detected recurring payment (bill) or income.
export interface RecurringScheduleDTO {
  token: string;            // merchant token (stable id)
  name: string;
  accountId: string | null;
  direction: "out" | "in";  // out = bill, in = income
  amount: number;
  kind: "fixed" | "variable";   // is the amount stable or does it vary?
  prevAmount: number | null;    // prior amount when it recently increased (else null)
  cadence: string;          // monthly | weekly | yearly | irregular
  dayOfMonth: number | null;
  lastSeen: string | null;  // ISO date of the last matching transaction
  nextDue: string | null;   // ISO date of the next expected occurrence
  status: "auto" | "confirmed" | "ignored";
}

// A single expected occurrence within the upcoming window.
export interface UpcomingItemDTO {
  token: string;
  name: string;
  amount: number;
  direction: "out" | "in";
  kind: "fixed" | "variable";   // bills only; income is reported as fixed
  prevAmount: number | null;    // prior amount when the bill recently increased
  date: string;             // ISO date of this occurrence
  status: "auto" | "confirmed" | "ignored";
}

export interface UpcomingDTO {
  items: UpcomingItemDTO[]; // sorted by date, within the window
  windowDays: number;
  billsDueThisMonth: number;   // remaining "out" from today to month-end
  incomeDueThisMonth: number;  // remaining "in" from today to month-end
  billsNext30: number;
  incomeNext30: number;
}

export interface DebtPaymentDTO {
  id: string;
  date: string | null;
  amount: number;     // positive repayment amount
  name: string | null;
}
export interface DebtDTO {
  id: string;
  name: string;
  balance: number;            // currently owed
  interestRate: number | null; // annual % (usually null for family/friends)
  priority: number;           // manual payoff order (lower = pay first)
  targetPayment: number | null; // planned next payment (may be partial)
  excluded: boolean;          // hidden from the Debt screen focus (e.g. long-term mortgage)
  paidTotal: number;          // sum of linked repayments
  original: number;           // balance + paidTotal (rough starting amount)
  avgMonthly: number;         // average monthly repayment pace
  lastPaymentDate: string | null;
  projectedMonths: number | null; // months to clear at current pace (null = no pace)
  payments: DebtPaymentDTO[];
}
export interface DebtsDTO {
  debts: DebtDTO[];
  totalOwed: number;
  totalPaid: number;
  monthlyTotal: number;       // total avg monthly repayment across debts
}

export interface InvestmentsDTO {
  providers: { key: string; name: string; configured: boolean }[];
  accounts: InvestmentAccountDTO[];
  total: number;
}

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
  institutionLogo: string | null;
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
  netWorth: number;     // everything incl. assets − debts
  investments: number;  // total across INVESTMENT accounts (ISA/crypto)
  assets: number;       // total across ASSET accounts (house, car)
  debts: number;        // total owed across LIABILITY accounts (positive)
  available: number;    // immediately available (banks + cash)
  included: { investments: boolean; assets: boolean; debts: boolean }; // what net worth counts
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export interface ManualAccountInput {
  name: string;
  type: AccountType;
  source?: "MANUAL" | "ASSET" | "LIABILITY";
  currency?: string;
  manualBalance?: string;
  interestRate?: string;
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
  group: string | null;
  monthlyAmount: number;
  sortOrder: number;
  archived: boolean;
}

export interface BudgetRowDTO {
  id: number;
  key: string;
  name: string;
  group: string | null;
  budgeted: number;
  spent: number;
  left: number;
  percent: number;
}

export interface BudgetSummaryDTO {
  available: number;     // personal-account balances − budgeted − setAside (money free to assign)
  spent: number;         // total personal spend this month
  spentLastMonth: number; // total personal spend last month (for the trend)
  budgeted: number;      // total of category monthly budgets
  setAside: number;      // monthly reserve for non-monthly (quarterly/annual) bills
  income: number;        // income this month (reference)
  pendingCount: number;  // pending transactions
}

// A non-monthly bill (quarterly/annual) smoothed into a monthly "set aside"
// target, YNAB-style: budget monthlyAmount each month and it's covered when due.
export interface BillTargetDTO {
  token: string;
  name: string;
  amount: number;        // full bill amount per occurrence (e.g. £600/yr)
  cadence: string;       // quarterly | yearly
  periodMonths: number;  // 3 | 12
  monthlyAmount: number; // amount ÷ periodMonths — the monthly set-aside
  monthsElapsed: number; // months into the current cycle (the "X" in "X of N")
  setAside: number;      // monthlyAmount × monthsElapsed — what should be saved by now
  nextDue: string | null;// ISO date of the next occurrence
}

export interface BudgetResponseDTO {
  rows: BudgetRowDTO[];
  billTargets: BillTargetDTO[];
  summary: BudgetSummaryDTO;
}

export interface CategoryInfoDTO {
  key: string;
  monthlyAmount: number;
  budgetedLastMonth: number;
  spentLastMonth: number;
  carriedForward: number;   // budgetedLastMonth − spentLastMonth
  goalAmount: number | null; // not tracked in the flat model → null (N/A)
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

// A single categoriser decision the LLM returned (id -> category key).
export interface AuditPick {
  id: string;
  categoryKey: string;
}

// Trace events streamed from the reconcile pipeline to the audit bottom sheet.
export type AuditEvent =
  | { kind: "scope"; total: number; uncategorised: number; categories: string[] }
  | { kind: "rules"; categorised: number; remaining: number }
  | { kind: "batch-request"; batch: number; items: { ref: string; id: string; text: string }[] }
  | { kind: "batch-raw"; batch: number; text: string }
  | { kind: "batch-parsed"; batch: number; returned: number; valid: number; dropped: AuditPick[] }
  | { kind: "batch-error"; batch: number; error: string }
  | { kind: "assign"; id: string; name: string; to: string; via: "rule" | "llm" }
  | { kind: "skip-uncategorised"; id: string; name: string }
  | { kind: "learn"; matchText: string; categoryKey: string }
  | { kind: "summary"; result: ReconcileResult }
  | { kind: "balance-change"; accountId: string; name: string; before: number; after: number; currency: string }
  | { kind: "new-txns"; account: string; items: { name: string; amount: number; date: string | null }[] }
  | { kind: "log"; text: string; tone?: "dim" | "green" | "yellow" | "red" | "cyan" | "bold" }
  | { kind: "fatal"; error: string };
export interface CategoryNameDTO {
  key: string;
  name: string;
}

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: "boolean";
  default: boolean;
}
export interface SettingsDTO {
  defs: SettingDef[];
  values: Record<string, boolean>;
}
