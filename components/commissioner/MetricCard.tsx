export function MetricCard({ label, value, hint, href }: { label: string; value: string | number; hint: string; href: string }) {
  return <a href={href} className="commissioner-metric card">
    <span>{label}</span><strong>{value}</strong><small>{hint}</small><em>View details →</em>
  </a>;
}
