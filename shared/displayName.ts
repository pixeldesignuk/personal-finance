export interface NameableAccount {
  id: string;
  name?: string | null;
  nickname?: string | null;
}

export function displayName(a: NameableAccount): string {
  if (a.nickname && a.nickname.trim()) return a.nickname;
  if (a.name && a.name.trim()) return a.name;
  return `Account ••${a.id.slice(-4)}`;
}
