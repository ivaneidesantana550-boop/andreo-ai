import { cn } from "@/lib/utils";

type AndreoMarkProps = {
  icon?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export default function AndreoMark({ icon = "A", size = "md", className }: AndreoMarkProps) {
  const sizes = {
    sm: "h-8 w-8 text-sm",
    md: "h-10 w-10 text-base",
    lg: "h-14 w-14 text-xl",
  } as const;

  return (
    <div className={cn("andreo-mark", sizes[size], className)} aria-label="Andreo">
      <span>{icon || "A"}</span>
    </div>
  );
}
