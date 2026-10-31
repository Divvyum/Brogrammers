/** Jaro-Winkler similarity, 0 (different) to 1 (identical). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  for (let i = 0, j = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[j]) j++;
    if (a[i] !== b[j]) transpositions++;
    j++;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Name similarity for duplicate detection: Jaro-Winkler on the full name, but 0
 * unless the surnames are also close and the first names start with the same
 * letter. Without that, "Isha Khan"/"Nisha Khan" and "Krishna Malhotra"/
 * "Krishna Sharma" score above the threshold. Inputs are normalized names.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = a.split(" ");
  const tb = b.split(" ");
  if (ta.length > 1 && tb.length > 1) {
    if (ta[0]![0] !== tb[0]![0]) return 0;
    if (jaroWinkler(ta[ta.length - 1]!, tb[tb.length - 1]!) < 0.9) return 0;
  }
  return jaroWinkler(a, b);
}

/** Lowercase, no punctuation, single spaces. "Asha  Rao." → "asha rao" */
export function normalizeText(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
