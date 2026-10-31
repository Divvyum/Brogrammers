/**
 * Canonical JSON: keys sorted, no spaces (Samrat's guide 6.1). The server signer,
 * the admin scanner and the participant app must all produce identical bytes.
 *
 * Like JSON.stringify, object keys whose value is undefined are left out, so an
 * optional field that is missing and one that is set to undefined sign the same.
 */
export function canonical(value: unknown): string {
  if (value === undefined) throw new Error("canonical: undefined is not JSON");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("canonical: non-finite number");
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
