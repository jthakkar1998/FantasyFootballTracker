"use client";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Home" },
  { href: "/admin/parlay", label: "Parlay" },
  { href: "/admin/live", label: "Live" },
  { href: "/admin/penalties", label: "Penalties" },
  { href: "/admin/tools", label: "Tools" }
];

export function CommissionerNavLinks() {
  const path = usePathname();
  return <nav className="commissioner-nav" aria-label="Commissioner sections">
    {links.map(item => <a href={item.href} key={item.href}
      aria-current={path === item.href ? "page" : undefined}>{item.label}</a>)}
  </nav>;
}
