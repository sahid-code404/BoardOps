"use client";

import { navForRole, type NavItem } from "./nav-config";

export type NavGroup = { title: string; items: NavItem[] };

/** Group nav items into Workspace / Finance / Administration sections. */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [
    { title: "Workspace", items: [] },
    { title: "Finance", items: [] },
    { title: "Administration", items: [] },
  ];
  items.forEach((i) => {
    if (["dashboard", "meals", "user-meals", "kitchen"].includes(i.view)) groups[0].items.push(i);
    else if (["billing", "payments", "expenses", "funds", "monthly-closing"].includes(i.view)) groups[1].items.push(i);
    else groups[2].items.push(i);
  });
  return groups.filter((g) => g.items.length > 0);
}

export function groupedNavForRole(role: "ADMIN" | "USER"): NavGroup[] {
  return groupNavItems(navForRole(role));
}
