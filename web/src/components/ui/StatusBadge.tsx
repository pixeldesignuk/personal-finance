// The matched / unmatched pill used on orders (Orders page + Plugins card).
export function MatchBadge({ matched }: { matched: boolean }) {
  return <span className={`badge ${matched ? "pos" : ""}`}>{matched ? "matched" : "unmatched"}</span>;
}
