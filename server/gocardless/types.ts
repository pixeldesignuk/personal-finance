export interface TokenResponse {
  access: string;
  access_expires: number; // seconds
  refresh: string;
  refresh_expires: number;
}

export interface GcInstitution {
  id: string;
  name: string;
  bic?: string;
  logo?: string; // PNG URL provided by GoCardless
  transaction_total_days?: string; // max history the bank exposes, in days (as a string)
}

export interface GcAgreement {
  id: string;
  max_historical_days: number;
  access_valid_for_days: number;
  access_scope: string[];
  institution_id: string;
}

export interface GcRequisition {
  id: string;
  status: string; // "CR" | "LN" | ...
  link: string;
  accounts: string[];
  institution_id: string;
  reference: string;
}

// The account *metadata* endpoint (`/accounts/{id}/`). After a requisition links,
// the account is PROCESSING until GoCardless finishes pulling it from the bank;
// details/balances/transactions 409 ("AccountProcessing") until `status` is READY.
export interface GcAccount {
  id: string;
  status: string; // "DISCOVERED" | "PROCESSING" | "READY" | "ERROR" | "EXPIRED" | "SUSPENDED"
  institution_id?: string;
  iban?: string;
  owner_name?: string;
  created?: string;
}

export interface GcAccountDetails {
  account?: {
    iban?: string;
    name?: string;
    currency?: string;
    ownerName?: string;
    cashAccountType?: string;
  };
}

export interface GcBalance {
  balanceAmount: { amount: string; currency: string };
  balanceType: string;
  referenceDate?: string;
}

export interface GcBalances {
  balances: GcBalance[];
}

export interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  merchantName?: string;
  [k: string]: unknown;
}

export interface GcTransactions {
  transactions: { booked?: GcTransaction[]; pending?: GcTransaction[] };
}
