// Provider-agnostic investment model. Trading 212 (equities) implements this
// now; Bitget (crypto) will implement the same interface next — so everything
// downstream (accounts, net worth, the Investments page) stays normalised.

export interface NormalizedHolding {
  symbol: string;      // provider ticker, e.g. "AAPL_US_EQ" or "BTC"
  name?: string;       // friendly name
  quantity: number;
  price: number;       // current price, account currency
  value: number;       // current value, account currency
  cost?: number;       // total cost basis
  pnl?: number;        // unrealised profit/loss
  currency?: string;
}

export interface InvestmentSnapshot {
  totalValue: number;  // total account value, account currency
  currency: string;
  cash: number;        // uninvested cash
  invested: number;    // current value of investments
  pnl: number;         // unrealised P/L
  holdings: NormalizedHolding[];
}

export interface InvestmentProvider {
  key: string;         // "trading212"
  name: string;        // "Trading 212"
  configured(): boolean;
  fetchSnapshot(): Promise<InvestmentSnapshot>;
}
