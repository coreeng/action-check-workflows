import { describe, expect, it } from 'vitest';
import {
  evaluateBranchFilters,
  evaluatePathFilters,
  evaluateTagFilters
} from '../src/patterns';

describe('evaluatePathFilters', () => {
  it('matches files using include patterns', () => {
    const result = evaluatePathFilters(['src/app.ts', 'docs/readme.md'], ['src/**'], []);
    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toEqual(['src/app.ts']);
  });

  it('respects negated include patterns', () => {
    const result = evaluatePathFilters(['src/app.ts', 'src/generated/file.ts'], ['src/**', '!src/generated/**'], []);
    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toEqual(['src/app.ts']);
  });

  it('respects ignore patterns with re-inclusion', () => {
    const result = evaluatePathFilters(
      ['docs/overview.md', 'docs/keep.md'],
      undefined,
      ['docs/**', '!docs/keep.md']
    );
    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toEqual(['docs/keep.md']);
  });

  it('returns false when no files match includes', () => {
    const result = evaluatePathFilters(['lib/index.ts'], ['docs/**'], undefined);
    expect(result.matches).toBe(false);
    expect(result.matchedFiles).toEqual([]);
  });
});

describe('evaluateBranchFilters', () => {
  it('passes when branch is allowed', () => {
    const result = evaluateBranchFilters('main', ['main'], []);
    expect(result.matches).toBe(true);
  });

  it('fails when branch is excluded', () => {
    const result = evaluateBranchFilters('release', undefined, ['release']);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain('branches-ignore');
  });

  it('fails when branch cannot be evaluated', () => {
    const result = evaluateBranchFilters(null, ['main'], undefined);
    expect(result.matches).toBe(false);
  });
});

describe('evaluateTagFilters', () => {
  it('passes when tag matches includes', () => {
    const result = evaluateTagFilters('v1.0.0', ['v*'], undefined);
    expect(result.matches).toBe(true);
  });

  it('fails when tag filtered out', () => {
    const result = evaluateTagFilters('beta', undefined, ['beta']);
    expect(result.matches).toBe(false);
  });
});
