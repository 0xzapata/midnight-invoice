import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS class names with proper conflict resolution.
 *
 * Combines `clsx` for conditional classes with `tailwind-merge` for
 * handling Tailwind CSS class conflicts (e.g., 'p-2 p-4' → 'p-4').
 *
 * @param inputs - Class values (strings, arrays, objects with boolean values)
 * @returns Merged class string with conflicts resolved
 *
 * @example
 * cn('p-2', 'p-4')                    // 'p-4'
 * cn('bg-red-500', isActive && 'bg-blue-500')  // 'bg-blue-500' if active
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Checks if the current environment is a test environment
 * @returns true if running in a test environment (like Vitest), false otherwise
 */
export function isTestEnvironment(): boolean {
  return typeof process !== 'undefined' && 
          process.env && 
          (process.env.NODE_ENV === 'test' || 
           process.env.VITEST === 'true' || 
           process.env.VITEST !== undefined);
}

export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) {
    return 'just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return `${diffDays}d ago`;
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

