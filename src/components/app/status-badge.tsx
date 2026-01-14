import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type Status = 'active' | 'suspended' | 'invited' | 'disabled' | 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';

const statusMap: Record<Status, { text: string; className: string }> = {
  active: { text: 'Active', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800' },
  invited: { text: 'Invited', className: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800' },
  disabled: { text: 'Disabled', className: 'bg-stone-100 text-stone-800 border-stone-200 dark:bg-stone-800/50 dark:text-stone-300 dark:border-stone-700' },
  suspended: { text: 'Suspended', className: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800' },
  CONNECTED: { text: 'Connected', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800' },
  DISCONNECTED: { text: 'Disconnected', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800' },
  CONNECTING: { text: 'Connecting', className: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/50 dark:text-yellow-300 dark:border-yellow-800' },
};


export function StatusBadge({ status, ...props }: BadgeProps & { status: Status }) {
  const { text, className } = statusMap[status];

  return (
    <Badge variant="outline" className={cn("font-medium", className)} {...props}>
      {text}
    </Badge>
  );
}
