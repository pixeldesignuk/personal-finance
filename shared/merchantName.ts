// Picking a merchant's name from a bank transaction's various name fields.
//
// Bank feeds are inconsistent: some put the merchant in `merchantName`, some in
// `creditorName`/`debtorName`, and some leave all of those as EMPTY STRINGS with
// the real name only in `remittanceInfo` (e.g. a "O2" phone bill). The naive
// `merchantName ?? creditorName ?? …` chain breaks on these, because `??` only
// falls through on null/undefined — an empty string "" is "defined", so the
// chain stops at "" and never reaches the populated field. That silently drops
// the transaction from merchant grouping, recurring detection, and naming.
// Always coalesce name fields through here so empty strings are skipped.

export interface RawMerchantFields {
  merchantName?: string | null;
  creditorName?: string | null;
  debtorName?: string | null;
  remittanceInfo?: string | null;
}

// First value that is a non-empty string once trimmed; null if none qualify.
export function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// The raw merchant label for a transaction, preferring the cleaner name fields
// and falling back to the remittance reference (which is the only place some
// feeds put the name). Set `includeRemittance: false` where the remittance line
// is noise rather than a name.
export function rawMerchantName(t: RawMerchantFields, includeRemittance = true): string | null {
  return firstNonEmpty(t.merchantName, t.creditorName, t.debtorName, includeRemittance ? t.remittanceInfo : null);
}
