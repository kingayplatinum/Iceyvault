export type PricingRule = { markupType: "fixed" | "percentage"; markupValue: number; minimumRetailKobo?: number | null };

/** Converts an upstream minor-unit amount to NGN kobo using a supplied, verified FX rate. */
export function calculateRetailKobo(wholesaleMinor: number, minorUnitsPerMajor: number, ngnPerMajor: number, rule: PricingRule): number {
  if (!Number.isFinite(wholesaleMinor) || wholesaleMinor < 0) throw new Error("Invalid wholesale amount.");
  if (!Number.isFinite(minorUnitsPerMajor) || minorUnitsPerMajor <= 0) throw new Error("Invalid currency minor-unit scale.");
  if (!Number.isFinite(ngnPerMajor) || ngnPerMajor <= 0) throw new Error("A verified FX rate is required.");
  const wholesaleKobo = Math.ceil((wholesaleMinor / minorUnitsPerMajor) * ngnPerMajor * 100);
  const markedUp = rule.markupType === "fixed"
    ? wholesaleKobo + Math.ceil(rule.markupValue)
    : Math.ceil(wholesaleKobo * (1 + rule.markupValue / 100));
  return Math.max(markedUp, rule.minimumRetailKobo ?? 0);
}
