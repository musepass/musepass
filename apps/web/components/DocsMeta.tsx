/**
 * The status tag every documentation page carries, per the 2026-10-01 review:
 * each page says in one word whether the thing it describes exists. The three
 * words map exactly to how the project talks about itself everywhere else —
 * "live" (you can do it now), "in development" (built, not deployed), and
 * "in design" (a decision with reasons, nothing running).
 *
 * A fourth kind, "planned", exists for pages whose whole point is that nothing
 * is running yet; use it sparingly and say what the blocker is in the text.
 */
export function StatusTag({ kind }: { kind: 'live' | 'dev' | 'design' | 'planned' }) {
  const label =
    kind === 'live'
      ? 'Live'
      : kind === 'dev'
        ? 'In development'
        : kind === 'design'
          ? 'In design'
          : 'Planned';
  return <span className={`tag tag-${kind}`}>{label}</span>;
}

/**
 * The uniform page opening the review asked for: what this page covers, in one
 * sentence, beside the status tag. Pages with mixed statuses pass one tag for
 * the main thing and mark the rest inline.
 */
export function DocsLede({
  lede,
  status,
}: {
  lede: React.ReactNode;
  status: 'live' | 'dev' | 'design' | 'planned';
}) {
  return (
    <div className="docs-lede-row">
      <StatusTag kind={status} />
      <p className="docs-lede">{lede}</p>
    </div>
  );
}
