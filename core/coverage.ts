import { assert } from './security';
export type CoverageUnit = {
  entryId: string;
  sortIndex: string;
  sourcePostIds: string[];
};
export const unitKey = (unit: CoverageUnit) =>
  JSON.stringify([unit.entryId, unit.sortIndex, unit.sourcePostIds]);
export function validateCoverage(
  raw: unknown,
  postIds: Set<string>,
): CoverageUnit[] {
  assert(
    Array.isArray(raw) && raw.length > 0 && raw.length <= 100,
    'Missing primary timeline coverage.',
  );
  const seen = new Set<string>();
  const units: CoverageUnit[] = [];
  for (const unit of raw) {
    assert(
      unit &&
        typeof unit === 'object' &&
        /^(?:tweet|profile-conversation)-\d{1,25}$/.test(unit.entryId) &&
        typeof unit.sortIndex === 'string' &&
        /^\d{1,40}$/.test(unit.sortIndex) &&
        !seen.has(unit.entryId),
      'Invalid primary timeline unit.',
    );
    seen.add(unit.entryId);
    assert(
      Array.isArray(unit.sourcePostIds) &&
        unit.sourcePostIds.length > 0 &&
        unit.sourcePostIds.length <= 100 &&
        unit.sourcePostIds.every(
          (id: unknown) => typeof id === 'string' && postIds.has(id),
        ),
      'Invalid timeline post coverage.',
    );
    units.push({
      entryId: unit.entryId,
      sortIndex: unit.sortIndex,
      sourcePostIds: [...new Set<string>(unit.sourcePostIds)].sort((a, b) =>
        BigInt(a) < BigInt(b) ? -1 : 1,
      ),
    });
  }
  units.sort((a, b) => (BigInt(a.sortIndex) > BigInt(b.sortIndex) ? -1 : 1));
  assert(
    units.length < 2 || units[0].sortIndex !== units[1].sortIndex,
    'Ambiguous timeline head.',
  );
  return units;
}
