import {
  type FinalizationClass,
  METRIC_NAMES,
  type MetricDefinition,
  type MetricPopulation,
  METRICS,
  RETENTION_OFFSETS,
  TRUNCATED_DIMENSIONS,
} from './analytics-metrics';

const definitions: [string, MetricDefinition][] = Object.entries(METRICS);

describe('analytics metric registry', () => {
  it('lists every metric by name', () => {
    expect(METRIC_NAMES.sort()).toEqual(Object.keys(METRICS).sort());
  });

  it.each(definitions)('%s has a positive integer version and a definition', (_name, metric) => {
    expect(Number.isInteger(metric.version)).toBe(true);
    expect(metric.version).toBeGreaterThan(0);
    expect(metric.definition.trim().length).toBeGreaterThan(0);
  });

  it.each(definitions)('%s lists each dimension once', (_name, metric) => {
    expect(new Set(metric.dimensions).size).toBe(metric.dimensions.length);
  });

  it('keeps a max metric in the presence class, the only one sampled per minute', () => {
    const maxClasses = new Set(
      definitions
        .filter(([, metric]) => metric.kind === 'max')
        .map(([, metric]) => metric.finalization),
    );

    expect([...maxClasses]).toEqual(['PRESENCE']);
  });

  it('never computes a distinct count or median over business facts, which are additive', () => {
    const perGrainOverFacts = definitions.filter(
      ([, metric]) => metric.kind === 'perGrain' && metric.population === 'F',
    );

    expect(perGrainOverFacts).toEqual([]);
  });

  it('never counts distinct anonymous tabs, which carry no identifier', () => {
    const anonymousPopulations: MetricPopulation[] = ['A', 'C_AND_A'];
    const distinctOverAnonymous = definitions.filter(
      ([, metric]) =>
        metric.kind === 'perGrain' && anonymousPopulations.includes(metric.population),
    );

    expect(distinctOverAnonymous).toEqual([]);
  });

  it.each<[MetricPopulation, FinalizationClass[]]>([
    ['F', ['FACT', 'MULTIPLAYER']],
    ['PRESENCE', ['PRESENCE']],
    ['A', ['PRESENCE']],
  ])('finalizes %s metrics only in %j', (population, classes) => {
    const strays = definitions.filter(
      ([, metric]) => metric.population === population && !classes.includes(metric.finalization),
    );

    expect(strays).toEqual([]);
  });

  it('truncates only dimensions some metric uses', () => {
    const used = new Set(definitions.flatMap(([, metric]) => metric.dimensions));

    for (const dimension of Object.keys(TRUNCATED_DIMENSIONS)) {
      expect(used).toContain(dimension);
    }
  });

  it('measures retention on increasing day offsets', () => {
    expect([...RETENTION_OFFSETS]).toEqual([...RETENTION_OFFSETS].sort((a, b) => a - b));
  });
});
