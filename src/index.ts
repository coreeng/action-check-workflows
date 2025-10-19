import * as core from '@actions/core';
import * as github from '@actions/github';
import { getChangedFiles } from './changed-files';
import { assessWorkflows } from './workflows';
import type { EventContext, GitHubRepository } from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getNestedValue(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function getNestedString(source: unknown, path: readonly string[]): string | null {
  const value = getNestedValue(source, path);
  return typeof value === 'string' ? value : null;
}

export async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const repoInput = core.getInput('repository');
  const baseRefInput = core.getInput('base-ref');
  const headRefInput = core.getInput('head-ref');
  const workflowRefInput = core.getInput('workflow-ref');
  const eventNameInput = core.getInput('event-name');
  const refInput = core.getInput('ref');
  const baseBranchInput = core.getInput('base-branch');
  const headBranchInput = core.getInput('head-branch');
  const actionInput = core.getInput('pull-request-action');
  const diffStrategyInput = (core.getInput('diff-strategy') || 'auto').toLowerCase();

  const context = github.context;

  const repository = resolveRepository(repoInput, context);
  const baseRef = resolveBaseRef(baseRefInput, context);
  const headRef = resolveHeadRef(headRefInput, context);
  const workflowRef = workflowRefInput ?? headRef;

  if (!baseRef || !headRef) {
    throw new Error('Both `base-ref` and `head-ref` must be provided or derivable from the event context.');
  }

  if (!workflowRef) {
    throw new Error('Unable to determine the ref to inspect workflows against.');
  }

  const diffStrategy = resolveDiffStrategy(diffStrategyInput, context.eventName ?? '');

  const octokit = github.getOctokit(token);

  const changedFiles = await getChangedFiles({
    octokit,
    repository,
    baseRef,
    headRef,
    diffStrategy
  });

  const eventContext: EventContext = buildEventContext({
    context,
    refOverride: refInput,
    eventNameOverride: eventNameInput,
    baseBranchOverride: baseBranchInput,
    headBranchOverride: headBranchInput,
    actionOverride: actionInput
  });

  const assessments = await assessWorkflows({
    octokit,
    repository,
    ref: workflowRef,
    changedFiles: changedFiles.files,
    context: eventContext
  });

  const triggeredWorkflows = assessments.filter((assessment) => assessment.autoTriggered);

  const report = {
    repository,
    baseRef,
    headRef,
    workflowRef,
    diffStrategy,
    changedFiles,
    workflows: assessments
  };

  core.setOutput('changed-files', JSON.stringify(changedFiles.files));
  core.setOutput('triggered-workflows', JSON.stringify(triggeredWorkflows));
  core.setOutput('report', JSON.stringify(report));

  await writeSummary({
    assessments,
    changedFilesCount: changedFiles.files.length,
    triggeredCount: triggeredWorkflows.length
  });
}

interface EventContextOptions {
  context: typeof github.context;
  refOverride?: string;
  eventNameOverride?: string;
  baseBranchOverride?: string;
  headBranchOverride?: string;
  actionOverride?: string;
}

function buildEventContext(options: EventContextOptions): EventContext {
  const { context, refOverride, eventNameOverride, baseBranchOverride, headBranchOverride, actionOverride } = options;
  const payload = context.payload as unknown;

  const ref = refOverride ?? context.ref ?? null;
  const eventName = eventNameOverride ?? context.eventName ?? 'push';
  const baseBranch =
    baseBranchOverride ??
    getNestedString(payload, ['pull_request', 'base', 'ref']) ??
    getNestedString(payload, ['merge_group', 'base_ref']) ??
    getNestedString(payload, ['workflow_run', 'head_branch']) ??
    null;
  const headBranch =
    headBranchOverride ??
    getNestedString(payload, ['pull_request', 'head', 'ref']) ??
    getNestedString(payload, ['merge_group', 'head_ref']) ??
    null;
  const actionValue = actionOverride ?? getNestedString(payload, ['action']);
  const action = actionValue ?? undefined;

  const refName = ref === null ? null : ref.replace(/^refs\//, '');
  const branchName =
    ref === null ? null : ref.startsWith('refs/heads/') ? ref.replace(/^refs\/heads\//, '') : ref;
  const tagName = ref !== null && ref.startsWith('refs/tags/') ? ref.replace(/^refs\/tags\//, '') : null;

  return {
    ref,
    refName,
    branchName,
    tagName,
    baseBranch,
    headBranch,
    eventName,
    action
  };
}

function resolveRepository(repoInput: string, context: typeof github.context): GitHubRepository {
  if (repoInput) {
    const [owner, repo] = repoInput.split('/');
    if (!owner || !repo) {
      throw new Error('`repository` input must be in the form "owner/repo".');
    }
    return { owner, repo };
  }

  if (!context.repo?.owner || !context.repo?.repo) {
    throw new Error('Unable to determine repository from context.');
  }

  return { owner: context.repo.owner, repo: context.repo.repo };
}

function resolveBaseRef(baseRefInput: string, context: typeof github.context): string | null {
  if (baseRefInput) {
    return baseRefInput;
  }

  const payload = context.payload as unknown;

  if (context.eventName === 'pull_request' || context.eventName === 'pull_request_target') {
    return getNestedString(payload, ['pull_request', 'base', 'sha']);
  }

  if (context.eventName === 'push') {
    return getNestedString(payload, ['before']);
  }

  return null;
}

function resolveHeadRef(headRefInput: string, context: typeof github.context): string | null {
  if (headRefInput) {
    return headRefInput;
  }

  const payload = context.payload as unknown;

  if (context.eventName === 'pull_request' || context.eventName === 'pull_request_target') {
    return getNestedString(payload, ['pull_request', 'head', 'sha']);
  }

  const sha = context.sha;
  return sha ?? null;
}

function resolveDiffStrategy(strategy: string, eventName: string): 'two-dot' | 'three-dot' {
  if (strategy === 'two-dot' || strategy === 'three-dot') {
    return strategy;
  }

  if (eventName === 'push') {
    return 'two-dot';
  }

  return 'three-dot';
}

async function writeSummary(options: {
  assessments: Awaited<ReturnType<typeof assessWorkflows>>;
  changedFilesCount: number;
  triggeredCount: number;
}): Promise<void> {
  const { assessments, changedFilesCount, triggeredCount } = options;

  core.summary.addHeading('Workflow Trigger Assessment', 2);
  core.summary.addRaw(`Changed files analysed: **${changedFilesCount}**\n`);
  core.summary.addRaw(`Workflows automatically triggered: **${triggeredCount}**\n\n`);

  if (assessments.length) {
    core.summary.addTable([
      ['Workflow', 'Triggered', 'Reasons / Matched Files'],
      ...assessments.map((assessment) => [
        assessment.name,
        assessment.autoTriggered ? 'Yes' : 'No',
        assessment.triggers
          .map((trigger) => {
            const status = trigger.matches ? '✅' : '❌';
            if (trigger.matches) {
              return `${status} ${trigger.event}`;
            }
            const reason = trigger.reasons.join('; ') || 'Not triggered';
            return `${status} ${trigger.event}: ${reason}`;
          })
          .join('\n')
      ])
    ]);
  }

  await core.summary.write();
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  run().catch((error) => {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred.');
    }
  });
}
