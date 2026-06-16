// Is an account a credit card? An explicit user override wins; otherwise fall back
// to the bank-reported ISO-20022 cash-account type ("CARD"). Pure — shared by the
// accounts DTO and the health engine so both agree.
export interface CardLike {
  creditCard?: boolean | null;
  cashAccountType?: string | null;
}

export function isCreditCard(a: CardLike): boolean {
  return a.creditCard ?? a.cashAccountType === "CARD";
}
