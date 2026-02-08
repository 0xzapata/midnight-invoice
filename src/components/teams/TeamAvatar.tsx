import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TeamAvatarProps {
  name: string;
  logoUrl?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-12 w-12 text-lg",
  xl: "h-16 w-16 text-xl",
};

const iconSizes = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 20,
  xl: 28,
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getTeamColor(name: string): string {
  const colors = [
    "bg-red-500/20 text-red-400",
    "bg-orange-500/20 text-orange-400",
    "bg-amber-500/20 text-amber-400",
    "bg-green-500/20 text-green-400",
    "bg-emerald-500/20 text-emerald-400",
    "bg-teal-500/20 text-teal-400",
    "bg-cyan-500/20 text-cyan-400",
    "bg-sky-500/20 text-sky-400",
    "bg-blue-500/20 text-blue-400",
    "bg-indigo-500/20 text-indigo-400",
    "bg-violet-500/20 text-violet-400",
    "bg-purple-500/20 text-purple-400",
    "bg-fuchsia-500/20 text-fuchsia-400",
    "bg-pink-500/20 text-pink-400",
    "bg-rose-500/20 text-rose-400",
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

export function TeamAvatar({ name, logoUrl, size = "md", className }: TeamAvatarProps) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={cn(
          "rounded-lg object-cover bg-secondary",
          sizeClasses[size],
          className
        )}
      />
    );
  }

  const initials = getInitials(name);
  const colorClass = getTeamColor(name);

  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center font-semibold shrink-0",
        sizeClasses[size],
        colorClass,
        className
      )}
    >
      {initials || <Building2 size={iconSizes[size]} />}
    </div>
  );
}

export function PersonalAvatar({ size = "md", className }: Omit<TeamAvatarProps, "name" | "logoUrl">) {
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center bg-muted text-muted-foreground shrink-0",
        sizeClasses[size],
        className
      )}
    >
      <Building2 size={iconSizes[size]} />
    </div>
  );
}
