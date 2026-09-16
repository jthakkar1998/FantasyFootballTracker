export function TeamIdentity({ name, logo }: { name: string; logo: string | null }) {
  return (
    <span className="team-identity">
      {logo ? <img src={logo} alt="" className="team-logo" /> : <span className="team-logo fallback">{name.slice(0, 1)}</span>}
      <span>{name}</span>
    </span>
  );
}
