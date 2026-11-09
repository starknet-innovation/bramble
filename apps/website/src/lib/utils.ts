/** Composes trusted component classes while resolving Tailwind utility conflicts. */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Returns a normalized class-name string for local presentation components. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
