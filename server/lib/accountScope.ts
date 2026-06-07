export function accountScope(accountId?: string): { accountId?: string } {
  if (!accountId || accountId === "all") return {};
  return { accountId };
}
