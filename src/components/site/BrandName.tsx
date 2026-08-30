import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showSubtitle?: boolean;
  align?: "left" | "center" | "right";
}

export function BrandName({
  className,
  size = "md",
  showSubtitle = true,
  align = "left",
}: BrandNameProps) {
  const sizeClasses = {
    sm: {
      title: "text-sm sm:text-base",
      sub: "text-[8px] tracking-[0.2em]",
    },
    md: {
      title: "text-base sm:text-lg lg:text-xl",
      sub: "text-[8.5px] sm:text-[9.5px] tracking-[0.22em]",
    },
    lg: {
      title: "text-xl sm:text-2xl",
      sub: "text-[10px] sm:text-[11px] tracking-[0.24em]",
    },
    xl: {
      title: "text-2xl sm:text-3xl lg:text-4xl",
      sub: "text-xs sm:text-sm tracking-[0.26em]",
    },
  }[size];

  const alignClass = {
    left: "items-start text-left",
    center: "items-center text-center",
    right: "items-end text-right",
  }[align];

  return (
    <div className={cn("flex flex-col leading-none select-none", alignClass, className)}>
      <div className={cn("font-display font-extrabold tracking-tight", sizeClasses.title)}>
        <span className="text-foreground">Zérah</span>{" "}
        <span className="text-[#F28282] dark:text-[#F87171]">Baby</span>
      </div>
      {showSubtitle && (
        <span
          className={cn(
            "mt-0.5 font-bold uppercase text-muted-foreground/80 font-sans",
            sizeClasses.sub,
          )}
        >
          AND KIDS
        </span>
      )}
    </div>
  );
}
