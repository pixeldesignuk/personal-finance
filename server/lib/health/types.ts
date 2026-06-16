import type { AccountFundingDTO, HealthCheckResultDTO } from "../../../shared/types.ts";
import type { FundingSchedule, IncomeReceived } from "../funding.ts";

// A spendable account as the health engine sees it.
export interface HealthAccount {
  id: string;
  name: string;          // display name, used in recommendations ("Savings")
  balance: number;
  informational: boolean; // not-for-spending (savings-ish) → preferred recommendation source
  isCreditCard?: boolean; // a credit card: negative balance is debt, not an overdraft
}

// Shared, precomputed inputs handed to every check so they don't redo work.
export interface HealthContext {
  today: Date;
  accounts: HealthAccount[];                       // spendable (BANK + MANUAL)
  schedules: FundingSchedule[];                    // recurring in + out
  income: IncomeReceived;
  netFlowByAccount: Map<string, number>;           // avg monthly net flow (signed)
  fundingByAccount: Map<string, AccountFundingDTO>; // runway numbers per account
}

export interface Source {
  id: string;
  name: string;
  available: number; // free cash
}

// A check inspects one account against the context, returning a result or null.
export type HealthCheck = (account: HealthAccount, ctx: HealthContext) => HealthCheckResultDTO | null;
