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
}

export interface GcRequisition {
  id: string;
  status: string; // "CR" | "LN" | ...
  link: string;
  accounts: string[];
  institution_id: string;
  reference: string;
}

export interface GcAccountDetails {
  account?: {
    iban?: string;
    name?: string;
    currency?: string;
    ownerName?: string;
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
