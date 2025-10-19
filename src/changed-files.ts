import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';
import type { GitHub } from '@actions/github/lib/utils';
import { ChangedFile, GitHubRepository } from './types';

type OctokitClient = InstanceType<typeof GitHub>;

interface CompareFilePayload {
  filename?: string;
  status?: string;
  previous_filename?: string | null;
}

interface CompareCommitsPayload {
  files?: CompareFilePayload[] | null;
  total_files?: number | null;
}

export interface ChangedFilesOptions {
  octokit: OctokitClient;
  repository: GitHubRepository;
  baseRef: string;
  headRef: string;
  diffStrategy?: 'two-dot' | 'three-dot';
}

export interface ChangedFilesResult {
  files: ChangedFile[];
  source: 'api' | 'git';
  truncated: boolean;
}

export async function getChangedFiles(options: ChangedFilesOptions): Promise<ChangedFilesResult> {
  const { octokit, repository, baseRef, headRef, diffStrategy = 'three-dot' } = options;

  const basehead = diffStrategy === 'two-dot' ? `${baseRef}..${headRef}` : `${baseRef}...${headRef}`;
  const compareResponse = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: repository.owner,
    repo: repository.repo,
    basehead,
    per_page: 100
  });

  const payload = normalizeCompareResponse(compareResponse.data);
  const files = mapCompareResponse(payload);
  const totalFiles = typeof payload.total_files === 'number' ? payload.total_files : files.length;
  const truncated = totalFiles > files.length || files.length >= 300;

  if (!truncated) {
    return {
      files,
      source: 'api',
      truncated: false
    };
  }

  core.info(
    `Compare API returned ${files.length} files (possibly truncated). Falling back to local git diff for complete list.`
  );

  const fallbackFiles = await getFilesFromGit(baseRef, headRef, diffStrategy);

  return {
    files: fallbackFiles,
    source: 'git',
    truncated: false
  };
}

function mapCompareResponse(data: CompareCommitsPayload): ChangedFile[] {
  const entries = Array.isArray(data.files) ? data.files : [];

  const results: ChangedFile[] = [];

  for (const entry of entries) {
    if (!isCompareFile(entry)) {
      continue;
    }

    const status = normalizeStatus(entry.status);
    const path = normalizePath(entry.filename);
    const previousPath = entry.previous_filename ? normalizePath(entry.previous_filename) : undefined;

    results.push({
      path,
      status,
      previousPath
    });
  }

  return results;
}

function normalizeCompareResponse(data: unknown): CompareCommitsPayload {
  if (typeof data !== 'object' || data === null) {
    return {};
  }

  const record = data as { files?: unknown; total_files?: unknown };
  return {
    files: Array.isArray(record.files) ? (record.files as CompareFilePayload[]) : undefined,
    total_files: typeof record.total_files === 'number' ? record.total_files : null
  };
}

async function getFilesFromGit(
  baseRef: string,
  headRef: string,
  diffStrategy: 'two-dot' | 'three-dot'
): Promise<ChangedFile[]> {
  const range = diffStrategy === 'two-dot' ? `${baseRef}..${headRef}` : `${baseRef}...${headRef}`;

  const args = ['diff', '--name-status', range];
  const { stdout } = await getExecOutput('git', args, { silent: true });

  const files: ChangedFile[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;

    const [statusToken, ...rest] = line.split('\t');
    if (!statusToken) continue;

    if (statusToken.startsWith('R')) {
      const [previousPath, path] = rest;
      if (!previousPath || !path) {
        continue;
      }

      files.push({
        path: normalizePath(path),
        previousPath: normalizePath(previousPath),
        status: 'renamed'
      });
      continue;
    }

    const [path] = rest;
    if (!path) {
      continue;
    }

    files.push({
      path: normalizePath(path),
      status: normalizeStatus(statusToken)
    });
  }

  return files;
}

function isCompareFile(file: unknown): file is Required<Pick<CompareFilePayload, 'filename'>> & CompareFilePayload {
  return (
    typeof file === 'object' &&
    file !== null &&
    typeof (file as { filename?: unknown }).filename === 'string'
  );
}

function normalizeStatus(status: string | undefined): ChangedFile['status'] {
  switch (status) {
    case 'added':
    case 'A':
      return 'added';
    case 'modified':
    case 'M':
      return 'modified';
    case 'removed':
    case 'D':
      return 'removed';
    case 'renamed':
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}
