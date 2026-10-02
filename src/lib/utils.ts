import { clsx, type ClassValue } from "clsx";

/** Joins class names. The app's own classes are plain CSS, so no Tailwind conflict merging is needed. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
