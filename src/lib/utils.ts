import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const num = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '–');
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "updated 3h ago" for a time today or yesterday, else "updated 22 Nov". Takes a date or an ISO time. */
export function updated(asOf: string, now = Date.now(), verb = 'updated') {
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return '';
  const min = Math.round((now - t) / 60000);
  if (asOf.length > 10 && min < 60) return min < 2 ? `${verb} just now` : `${verb} ${min}m ago`;
  if (asOf.length > 10 && min < 48 * 60) return `${verb} ${Math.round(min / 60)}h ago`;
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return asOf.length > 10 ? `${verb} ${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${verb} ${day}`;
}
export const signed = (n: number, digits = 2) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;

/** Remembers the last result for the same arguments (compared by reference). */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => Object.is(a, args[i]))) return last.value;
    const value = fn(...args);
    last = { args, value };
    return value;
  };
}
