export function effectiveCategory(tx: { category: string; categoryOverride?: string | null }): string {
  return tx.categoryOverride ?? tx.category;
}
