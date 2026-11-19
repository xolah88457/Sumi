import {
  BarChart3,
  BookOpen,
  BookText,
  BookmarkPlus,
  CalendarDays,
  Import,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  NotebookPen,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Sidebar groups, shared with the command palette so both list the same routes. */
export const NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Review",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/journal", label: "Daily journal", icon: NotebookPen },
      { href: "/trades", label: "Trades", icon: ListOrdered },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Study",
    items: [
      { href: "/notebook", label: "Notebook", icon: BookText },
      { href: "/playbooks", label: "Playbooks", icon: BookOpen },
      { href: "/progress", label: "Progress", icon: ListChecks },
      { href: "/missed", label: "Missed trades", icon: BookmarkPlus },
      { href: "/prop-firms", label: "Prop firms", icon: Landmark },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/import", label: "Import", icon: Import },
      { href: "/accounts", label: "Accounts", icon: Wallet },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
