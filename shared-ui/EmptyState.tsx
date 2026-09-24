export default function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="ig-empty">
      <strong>{title}</strong>
      <p className="ig-muted">{body}</p>
    </div>
  );
}
