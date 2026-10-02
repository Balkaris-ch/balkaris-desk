/** Class names joined, with whatever is false, null or undefined left out. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
