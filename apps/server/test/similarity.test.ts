import { describe, expect, it } from "vitest";
import { FUZZY_THRESHOLD } from "../src/admin/registrations/duplicates.js";
import { jaroWinkler, nameSimilarity, normalizeText } from "../src/admin/registrations/similarity.js";

const same = (a: string, b: string) => nameSimilarity(normalizeText(a), normalizeText(b)) >= FUZZY_THRESHOLD;

describe("duplicate name matching", () => {
  it("matches typos of the same name", () => {
    expect(same("Reyansh Nair", "Reyaansh Nair")).toBe(true);
    expect(same("Manav Gupta", "Manav Guptah")).toBe(true);
    expect(same("Asha  Rao.", "asha rao")).toBe(true);
  });

  it("doesn't match different people with similar names", () => {
    expect(same("Isha Khan", "Nisha Khan")).toBe(false);
    expect(same("Krishna Malhotra", "Krishna Sharma")).toBe(false);
    expect(same("Riya Shah", "Diya Shah")).toBe(false);
  });

  it("jaroWinkler has the textbook values", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("", "x")).toBe(0);
  });
});
