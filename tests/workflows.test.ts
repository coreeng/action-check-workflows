import { describe, expect, it, vi } from 'vitest';
import { evaluateWorkflowTriggers } from '../src/workflows';
import type { EventContext } from '../src/types';

vi.mock('@actions/workflow-parser', () => ({
  NoOperationTraceWriter: class {},
  convertWorkflowTemplate: vi.fn(),
  parseWorkflow: vi.fn()
}));

const baseContext: EventContext = {
  ref: 'refs/heads/main',
  refName: 'heads/main',
  branchName: 'main',
  tagName: null,
  baseBranch: 'main',
  headBranch: 'feature/change',
  eventName: 'push',
  action: 'synchronize'
};

describe('evaluateWorkflowTriggers', () => {
  it('identifies push workflow triggered by changed files', () => {
    const template = {
      events: {
        push: {
          paths: ['src/**']
        }
      }
    } as unknown;

    const triggers = evaluateWorkflowTriggers(template as never, ['src/index.ts'], baseContext);
    const pushTrigger = triggers.find((trigger) => trigger.event === 'push');
    expect(pushTrigger).toBeDefined();
    expect(pushTrigger?.matches).toBe(true);
    expect(pushTrigger?.matchedFiles).toEqual(['src/index.ts']);
  });

  it('flags pull_request workflow excluded by paths-ignore', () => {
    const template = {
      events: {
        pull_request: {
          paths: ['docs/**'],
          'paths-ignore': ['docs/generated/**']
        }
      }
    } as unknown;

    const context: EventContext = {
      ...baseContext,
      eventName: 'pull_request',
      baseBranch: 'main',
      branchName: 'feature/change',
      action: 'synchronize'
    };

    const triggers = evaluateWorkflowTriggers(template as never, ['docs/generated/file.md'], context);
    const prTrigger = triggers.find((trigger) => trigger.event === 'pull_request');
    expect(prTrigger).toBeDefined();
    expect(prTrigger?.matches).toBe(false);
    expect(prTrigger?.reasons.join(' ')).toContain('paths-ignore');
  });

  it('requires pull_request types to include action', () => {
    const template = {
      events: {
        pull_request: {
          types: ['opened']
        }
      }
    } as unknown;

    const context: EventContext = {
      ...baseContext,
      eventName: 'pull_request',
      action: 'synchronize'
    };

    const triggers = evaluateWorkflowTriggers(template as never, ['src/index.ts'], context);
    const prTrigger = triggers.find((trigger) => trigger.event === 'pull_request');
    expect(prTrigger).toBeDefined();
    expect(prTrigger?.matches).toBe(false);
    expect(prTrigger?.reasons.join(' ')).toContain('types');
  });
});
