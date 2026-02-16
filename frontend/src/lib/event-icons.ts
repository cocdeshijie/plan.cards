import {
  CreditCard,
  XCircle,
  ArrowLeftRight,
  DollarSign,
  Undo2,
  Gift,
  MoreHorizontal,
  RefreshCw,
  CalendarClock,
  Clock,
  Star,
  Cake,
  type LucideIcon,
} from "lucide-react";

export interface EventMeta {
  icon: LucideIcon;
  label: string;
  colorClass: string;
  badgeColor: string;
}

const EVENT_META: Record<string, EventMeta> = {
  opened: {
    icon: CreditCard,
    label: "Opened",
    colorClass: "bg-green-500",
    badgeColor: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  closed: {
    icon: XCircle,
    label: "Closed",
    colorClass: "bg-red-500",
    badgeColor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
  product_change: {
    icon: ArrowLeftRight,
    label: "Product Change",
    colorClass: "bg-blue-500",
    badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  annual_fee_posted: {
    icon: DollarSign,
    label: "Annual Fee",
    colorClass: "bg-orange-500",
    badgeColor: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  annual_fee_refund: {
    icon: Undo2,
    label: "Annual Fee Refund",
    colorClass: "bg-green-500",
    badgeColor: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  retention_offer: {
    icon: Gift,
    label: "Retention Offer",
    colorClass: "bg-purple-500",
    badgeColor: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
  reopened: {
    icon: RefreshCw,
    label: "Reopened",
    colorClass: "bg-emerald-500",
    badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  other: {
    icon: MoreHorizontal,
    label: "Other",
    colorClass: "bg-gray-500",
    badgeColor: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  },
  // Synthetic future event types
  annual_fee_upcoming: {
    icon: CalendarClock,
    label: "Upcoming Fee",
    colorClass: "bg-orange-400",
    badgeColor: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  spend_deadline: {
    icon: Clock,
    label: "Spend Deadline",
    colorClass: "bg-purple-400",
    badgeColor: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  bonus_deadline: {
    icon: Star,
    label: "Bonus Deadline",
    colorClass: "bg-green-400",
    badgeColor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  anniversary: {
    icon: Cake,
    label: "Anniversary",
    colorClass: "bg-blue-400",
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
};

export function getEventMeta(eventType: string): EventMeta {
  return EVENT_META[eventType] || EVENT_META.other;
}
