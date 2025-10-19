import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChangedFiles } from '../src/changed-files';

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn()
}));

vi.mock('@actions/core', () => ({
  info: vi.fn()
}));

vi.mock('@actions/exec', () => ({
  getExecOutput: execMock
}));

function createOctokit(response: unknown) {
  return {
    rest: {
      repos: {
        compareCommitsWithBasehead: vi.fn().mockResolvedValue(response)
      }
    }
  } as unknown as Parameters<typeof getChangedFiles>[0]['octokit'];
}

const repository = { owner: 'octo', repo: 'example' };

beforeEach(() => {
  execMock.mockReset();
});

describe('getChangedFiles', () => {
  it('returns files from compare API when not truncated', async () => {
    const octokit = createOctokit({
      data: {
        files: [
          { filename: 'src/index.ts', status: 'modified' },
          { filename: 'README.md', status: 'added' }
        ],
        total_files: 2
      }
    });

    const result = await getChangedFiles({
      octokit,
      repository,
      baseRef: 'base',
      headRef: 'head',
      diffStrategy: 'three-dot'
    });

    expect(result.source).toBe('api');
    expect(result.truncated).toBe(false);
    expect(result.files).toEqual([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'README.md', status: 'added' }
    ]);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('falls back to git diff when API response is truncated', async () => {
    const octokit = createOctokit({
      data: {
        files: new Array(300).fill(null).map((_, index) => ({
          filename: `file-${index}.txt`,
          status: 'modified'
        })),
        total_files: 400
      }
    });

    execMock.mockResolvedValue({
      stdout: 'A\tnew-file.ts\nR100\told-name.ts\tnew-name.ts\n',
      stderr: ''
    });

    const result = await getChangedFiles({
      octokit,
      repository,
      baseRef: 'base',
      headRef: 'head',
      diffStrategy: 'three-dot'
    });

    expect(result.source).toBe('git');
    expect(result.files).toEqual([
      { path: 'new-file.ts', status: 'added' },
      { path: 'new-name.ts', previousPath: 'old-name.ts', status: 'renamed' }
    ]);
    expect(execMock).toHaveBeenCalledWith('git', ['diff', '--name-status', 'base...head'], {
      silent: true
    });
  });
});
