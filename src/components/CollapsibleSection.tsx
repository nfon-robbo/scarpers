import { ReactNode, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChevronDown, LucideIcon } from "lucide-react";

interface CollapsibleSectionProps {
  title: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  headerExtra?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  children: ReactNode;
}

const CollapsibleSection = ({
  title,
  icon: Icon,
  description,
  headerExtra,
  defaultOpen = false,
  className,
  contentClassName,
  titleClassName,
  children,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex-1 min-w-0">
            <CardTitle className={`text-lg flex items-center gap-2 ${titleClassName ?? ""}`}>
              {Icon && <Icon className="w-5 h-5" />}
              <span className="truncate">{title}</span>
              {headerExtra}
            </CardTitle>
            {description && <CardDescription className="mt-1.5">{description}</CardDescription>}
          </div>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground shrink-0 mt-1 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </CardHeader>
      </button>
      {open && <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  );
};

export default CollapsibleSection;
