import picomatch, { Matcher } from 'picomatch';

const PICOMATCH_OPTIONS = {
  dot: true,
  posixSlashes: true,
  nocase: false
} as const;

interface CompiledPattern {
  pattern: string;
  negate: boolean;
  matcher: Matcher;
}

function compilePattern(pattern: string): CompiledPattern {
  const negate = pattern.startsWith('!');
  const source = negate ? pattern.slice(1) : pattern;
  return {
    pattern,
    negate,
    matcher: picomatch(source, PICOMATCH_OPTIONS)
  };
}

export function compilePatterns(patterns: readonly string[] = []): CompiledPattern[] {
  return patterns
    .filter((pattern): pattern is string => pattern.length > 0)
    .map((pattern) => compilePattern(pattern));
}

export function matchesCompiled(value: string, compiled: CompiledPattern[]): boolean {
  if (compiled.length === 0) {
    return false;
  }

  let matched = false;
  for (const pattern of compiled) {
    if (pattern.matcher(value)) {
      matched = pattern.negate ? false : true;
    }
  }

  return matched;
}

export function evaluatePathFilters(
  files: readonly string[],
  includes: readonly string[] | undefined,
  excludes: readonly string[] | undefined
): {
  matches: boolean;
  matchedFiles: string[];
  reasons: string[];
} {
  const reasons: string[] = [];
  let considered = [...files];

  if (includes?.length) {
    const compiledIncludes = compilePatterns(includes);
    const included = considered.filter((file) => matchesCompiled(file, compiledIncludes));

    if (included.length === 0) {
      reasons.push('No changed files satisfied `paths` filter.');
      return {
        matches: false,
        matchedFiles: [],
        reasons
      };
    }

    considered = included;
  }

  if (excludes?.length) {
    const compiledExcludes = compilePatterns(excludes);
    const ignored = new Set<string>();

    for (const file of considered) {
      if (matchesCompiled(file, compiledExcludes)) {
        ignored.add(file);
      }
    }

    if (ignored.size === considered.length) {
      reasons.push('All matching files were ignored by `paths-ignore` filter.');
      return {
        matches: false,
        matchedFiles: [],
        reasons
      };
    }

    considered = considered.filter((file) => !ignored.has(file));
  }

  return {
    matches: considered.length > 0,
    matchedFiles: considered,
    reasons
  };
}

export function evaluateBranchFilters(
  branch: string | null,
  includes: readonly string[] | undefined,
  excludes: readonly string[] | undefined
): {
  matches: boolean;
  reason?: string;
} {
  if (!branch) {
    return {
      matches: false,
      reason: 'Branch information unavailable to evaluate filters.'
    };
  }

  if (includes?.length) {
    const compiledIncludes = compilePatterns(includes);
    if (!matchesCompiled(branch, compiledIncludes)) {
      return {
        matches: false,
        reason: `Branch "${branch}" did not satisfy \`branches\` filter.`
      };
    }
  }

  if (excludes?.length) {
    const compiledExcludes = compilePatterns(excludes);
    if (matchesCompiled(branch, compiledExcludes)) {
      return {
        matches: false,
        reason: `Branch "${branch}" was excluded by \`branches-ignore\` filter.`
      };
    }
  }

  return { matches: true };
}

export function evaluateTagFilters(
  tag: string | null,
  includes: readonly string[] | undefined,
  excludes: readonly string[] | undefined
): {
  matches: boolean;
  reason?: string;
} {
  if (!tag) {
    return {
      matches: false,
      reason: 'Tag information unavailable to evaluate filters.'
    };
  }

  if (includes?.length) {
    const compiledIncludes = compilePatterns(includes);
    if (!matchesCompiled(tag, compiledIncludes)) {
      return {
        matches: false,
        reason: `Tag "${tag}" did not satisfy \`tags\` filter.`
      };
    }
  }

  if (excludes?.length) {
    const compiledExcludes = compilePatterns(excludes);
    if (matchesCompiled(tag, compiledExcludes)) {
      return {
        matches: false,
        reason: `Tag "${tag}" was excluded by \`tags-ignore\` filter.`
      };
    }
  }

  return { matches: true };
}

export function evaluateTypesFilter(
  actualType: string | undefined,
  allowedTypes: readonly string[] | undefined
): {
  matches: boolean;
  reason?: string;
} {
  if (!allowedTypes?.length) {
    return { matches: true };
  }

  if (!actualType) {
    return {
      matches: false,
      reason: 'Event type information unavailable to evaluate `types`.'
    };
  }

  const compiled = compilePatterns(allowedTypes);
  if (!matchesCompiled(actualType, compiled)) {
    return {
      matches: false,
      reason: `Event type "${actualType}" did not satisfy configured \`types\`.`
    };
  }

  return { matches: true };
}
