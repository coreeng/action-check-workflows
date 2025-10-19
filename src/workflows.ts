import * as core from '@actions/core';
import type { GitHub } from '@actions/github/lib/utils';
import {
  NoOperationTraceWriter,
  convertWorkflowTemplate,
  parseWorkflow
} from '@actions/workflow-parser';
import { Buffer } from 'node:buffer';
import {
  ChangedFile,
  EventContext,
  GitHubRepository,
  WorkflowAssessment,
  WorkflowTriggerEvaluation
} from './types';
import {
  evaluateBranchFilters,
  evaluatePathFilters,
  evaluateTagFilters,
  evaluateTypesFilter
} from './patterns';

type OctokitClient = InstanceType<typeof GitHub>;
type WorkflowTemplate = Awaited<ReturnType<typeof convertWorkflowTemplate>>;

export interface LoadWorkflowsOptions {
  octokit: OctokitClient;
  repository: GitHubRepository;
  ref: string;
}

export interface AssessWorkflowsOptions extends LoadWorkflowsOptions {
  changedFiles: ChangedFile[];
  context: EventContext;
}

interface WorkflowFile {
  name: string;
  path: string;
  content: string;
}

interface DirectoryEntry {
  type?: string;
  name?: string;
  path?: string;
}

interface FileEntry extends DirectoryEntry {
  content?: string | null;
  encoding?: string | null;
}

export async function assessWorkflows(options: AssessWorkflowsOptions): Promise<WorkflowAssessment[]> {
  const { octokit, repository, ref, changedFiles, context } = options;

  const workflowFiles = await loadWorkflowFiles({ octokit, repository, ref });

  const pathSet = new Set<string>();
  for (const file of changedFiles) {
    pathSet.add(normalizePath(file.path));
    if (file.previousPath) {
      pathSet.add(normalizePath(file.previousPath));
    }
  }
  const changedPaths = Array.from(pathSet);

  core.info(
    `Evaluating ${workflowFiles.length} workflow file(s) at ${repository.owner}/${repository.repo}@${ref} with ${changedPaths.length} unique changed path(s).`
  );
  if (changedPaths.length) {
    core.info(`Changed paths: ${summarizeList(changedPaths)}`);
  }

  const assessments: WorkflowAssessment[] = [];

  for (const file of workflowFiles) {
    core.startGroup(`Workflow ${file.path}`);
    core.info(`Processing workflow file ${file.name}`);

    const { template, errors } = await parseWorkflowFile(file);

    if (!template) {
      if (errors.length) {
        for (const error of errors) {
          core.warning(`[${file.path}] ${error}`);
        }
      } else {
        core.warning(`[${file.path}] Workflow failed to parse for an unknown reason.`);
      }
      core.endGroup();
      assessments.push({
        name: file.name,
        path: file.path,
        triggers: [],
        autoTriggered: false,
        errors
      });
      continue;
    }

    const triggers = evaluateWorkflowTriggers(template, changedPaths, context);
    const autoTriggered = triggers.some((trigger) => trigger.matches);
    const matchedTriggers = triggers.filter((trigger) => trigger.matches);

    const workflowName = getTemplateName(template, file.name);

    if (errors.length) {
      for (const error of errors) {
        core.warning(`[${file.path}] ${error}`);
      }
    } else {
      core.info(`[${file.path}] Parsed successfully.`);
    }

    if (matchedTriggers.length) {
      core.info(`Triggered events: ${summarizeList(matchedTriggers.map((trigger) => trigger.event), 5)}`);
      const matchedFiles = new Set<string>();
      for (const trigger of matchedTriggers) {
        for (const matched of trigger.matchedFiles) {
          matchedFiles.add(matched);
        }
      }
      if (matchedFiles.size > 0) {
        core.info(`Matched files: ${summarizeList([...matchedFiles])}`);
      }
    } else if (triggers.length) {
      core.info('No events triggered for this workflow.');
      core.info(
        `Reasons: ${summarizeList(
          triggers.map((trigger) => `${trigger.event}: ${trigger.reasons.join('; ') || 'filters did not match'}`),
          5
        )}`
      );
    } else {
      core.info('Workflow does not define any triggers.');
    }

    core.info(`Auto triggered: ${autoTriggered ? 'yes' : 'no'} (${workflowName})`);

    assessments.push({
      name: workflowName,
      path: file.path,
      triggers,
      autoTriggered,
      errors
    });

    core.endGroup();
  }

  return assessments;
}

async function loadWorkflowFiles(options: LoadWorkflowsOptions): Promise<WorkflowFile[]> {
  const { octokit, repository, ref } = options;
  const files: WorkflowFile[] = [];

  await traverse('.github/workflows');
  return files;

  async function traverse(path: string): Promise<void> {
    try {
      const response = await octokit.rest.repos.getContent({
        owner: repository.owner,
        repo: repository.repo,
        path,
        ref
      });
      const data = response.data as unknown;

      if (Array.isArray(data)) {
        for (const entry of data) {
          if (isFileEntry(entry) && isWorkflowFile(entry.name)) {
            const fileResponse = await octokit.rest.repos.getContent({
              owner: repository.owner,
              repo: repository.repo,
              path: entry.path,
              ref
            });
            const resolved = fileResponse.data as unknown;
            if (!isFileEntry(resolved) || typeof resolved.content !== 'string') {
              continue;
            }

            files.push({
              name: entry.name,
              path: entry.path,
              content: decodeContent(resolved.content, resolved.encoding)
            });
          } else if (isDirectoryEntry(entry)) {
            await traverse(entry.path);
          }
        }
      } else if (isFileEntry(data) && typeof data.content === 'string' && isWorkflowFile(data.name)) {
        files.push({
          name: data.name,
          path: data.path,
          content: decodeContent(data.content, data.encoding)
        });
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        core.info(`No workflows found at ${path} for ref ${ref}.`);
        return;
      }

      throw error;
    }
  }
}

function isWorkflowFile(filename: string): boolean {
  return filename.endsWith('.yml') || filename.endsWith('.yaml');
}

function decodeContent(content: string, encoding?: string | null): string {
  if (encoding !== 'base64') {
    return content;
  }

  return Buffer.from(content, 'base64').toString('utf8');
}

async function parseWorkflowFile(file: WorkflowFile): Promise<{
  template: WorkflowTemplate | undefined;
  errors: string[];
}> {
  const trace = new NoOperationTraceWriter();
  const result = parseWorkflow({ name: file.name, content: file.content }, trace);

  if (!result.value) {
    return {
      template: undefined,
      errors: ['Workflow failed to parse.']
    };
  }

  const template = await convertWorkflowTemplate(result.context, result.value);
  const parseErrors = result.context.errors.getErrors().map((err) => err.message);
  const templateErrors = template.errors?.map((err) => err.Message) ?? [];

  return {
    template,
    errors: [...parseErrors, ...templateErrors]
  };
}

function getTemplateName(template: WorkflowTemplate, fallback: string): string {
  const nameToken = (template as { name?: { value?: unknown } }).name;
  const value = nameToken && typeof nameToken === 'object' ? (nameToken as { value?: unknown }).value : undefined;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function summarizeList(items: string[], max = 10): string {
  if (!items.length) {
    return 'none';
  }
  const visible = items.slice(0, max);
  const remainder = items.length - visible.length;
  return remainder > 0 ? `${visible.join(', ')}, …(+${remainder} more)` : visible.join(', ');
}

function isDirectoryEntry(entry: unknown): entry is Required<Pick<DirectoryEntry, 'path'>> & DirectoryEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as DirectoryEntry).type === 'dir' &&
    typeof (entry as DirectoryEntry).path === 'string'
  );
}

function isFileEntry(entry: unknown): entry is Required<Pick<FileEntry, 'name' | 'path'>> & FileEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as DirectoryEntry).type === 'file' &&
    typeof (entry as DirectoryEntry).name === 'string' &&
    typeof (entry as DirectoryEntry).path === 'string'
  );
}

export function evaluateWorkflowTriggers(
  template: WorkflowTemplate,
  changedPaths: string[],
  context: EventContext
): WorkflowTriggerEvaluation[] {
  const triggers: WorkflowTriggerEvaluation[] = [];

  if (!changedPaths.length) {
    return [
      {
        event: 'unknown',
        matches: false,
        reasons: ['No changed files were provided for evaluation.'],
        matchedFiles: [],
        evaluatedFilters: {}
      }
    ];
  }

  const events = (template as { events?: Record<string, unknown> }).events ?? {};

  for (const [eventName, config] of Object.entries(events)) {
    switch (eventName) {
      case 'push':
        triggers.push(evaluatePushEvent(config, changedPaths, context));
        break;
      case 'pull_request':
        triggers.push(evaluatePullRequestEvent('pull_request', config, changedPaths, context));
        break;
      case 'pull_request_target':
        triggers.push(evaluatePullRequestEvent('pull_request_target', config, changedPaths, context));
        break;
      case 'merge_group':
        triggers.push(evaluateMergeGroupEvent(config, changedPaths, context));
        break;
      case 'workflow_dispatch':
        triggers.push(manualTriggerEvaluation(eventName));
        break;
      case 'workflow_call':
        triggers.push(externalTriggerEvaluation(eventName, 'Triggered by other workflows'));
        break;
      default:
        triggers.push(genericTriggerEvaluation(eventName));
        break;
    }
  }

  if (triggers.length === 0) {
    triggers.push({
      event: 'none',
      matches: false,
      reasons: ['Workflow does not define any triggerable events.'],
      matchedFiles: [],
      evaluatedFilters: {}
    });
  }

  return triggers;
}

function evaluatePushEvent(
  config: unknown,
  changedPaths: string[],
  context: EventContext
): WorkflowTriggerEvaluation {
  const pushConfig = (config ?? {}) as Record<string, unknown>;
  const reasons: string[] = [];
  const evaluatedFilters: WorkflowTriggerEvaluation['evaluatedFilters'] = {};
  let matches = true;

  const branchFilters = {
    includes: extractStringArray(pushConfig.branches),
    excludes: extractStringArray(pushConfig['branches-ignore'])
  };
  const tagFilters = {
    includes: extractStringArray(pushConfig.tags),
    excludes: extractStringArray(pushConfig['tags-ignore'])
  };
  const pathFilters = {
    includes: extractStringArray(pushConfig.paths),
    excludes: extractStringArray(pushConfig['paths-ignore'])
  };

  const branchName = context.branchName;
  const tagName = context.tagName;

  if (branchFilters.includes.length || branchFilters.excludes.length) {
    evaluatedFilters.branches = true;
    const branchResult = evaluateBranchFilters(branchName, branchFilters.includes, branchFilters.excludes);
    if (!branchResult.matches) {
      matches = false;
      reasons.push(branchResult.reason ?? 'Branch filter did not match.');
    }
  }

  if (tagName) {
    evaluatedFilters.tags = Boolean(tagFilters.includes.length || tagFilters.excludes.length);
    if (evaluatedFilters.tags) {
      const tagResult = evaluateTagFilters(tagName, tagFilters.includes, tagFilters.excludes);
      if (!tagResult.matches) {
        matches = false;
        reasons.push(tagResult.reason ?? 'Tag filter did not match.');
      }
    }
  }

  if (pathFilters.includes.length || pathFilters.excludes.length) {
    evaluatedFilters.paths = true;
  }

  const pathResult = evaluatePathFilters(changedPaths, pathFilters.includes, pathFilters.excludes);
  if (!pathResult.matches) {
    matches = false;
    reasons.push(...pathResult.reasons);
  }

  return {
    event: 'push',
    matches,
    reasons,
    matchedFiles: pathResult.matchedFiles,
    evaluatedFilters
  };
}

function evaluatePullRequestEvent(
  eventName: 'pull_request' | 'pull_request_target',
  config: unknown,
  changedPaths: string[],
  context: EventContext
): WorkflowTriggerEvaluation {
  const prConfig = (config ?? {}) as Record<string, unknown>;
  const reasons: string[] = [];
  const evaluatedFilters: WorkflowTriggerEvaluation['evaluatedFilters'] = {};
  let matches = true;

  const branchFilters = {
    includes: extractStringArray(prConfig.branches),
    excludes: extractStringArray(prConfig['branches-ignore'])
  };
  const pathFilters = {
    includes: extractStringArray(prConfig.paths),
    excludes: extractStringArray(prConfig['paths-ignore'])
  };
  const typeFilters = extractStringArray(prConfig.types);

  if (branchFilters.includes.length || branchFilters.excludes.length) {
    evaluatedFilters.branches = true;
    const branchResult = evaluateBranchFilters(context.baseBranch, branchFilters.includes, branchFilters.excludes);
    if (!branchResult.matches) {
      matches = false;
      reasons.push(branchResult.reason ?? 'Base branch did not match filters.');
    }
  }

  if (pathFilters.includes.length || pathFilters.excludes.length) {
    evaluatedFilters.paths = true;
  }

  const pathResult = evaluatePathFilters(changedPaths, pathFilters.includes, pathFilters.excludes);
  if (!pathResult.matches) {
    matches = false;
    reasons.push(...pathResult.reasons);
  }

  if (typeFilters.length) {
    evaluatedFilters.types = true;
    const typesResult = evaluateTypesFilter(context.action, typeFilters);
    if (!typesResult.matches) {
      matches = false;
      reasons.push(typesResult.reason ?? '`types` filter did not include this event action.');
    }
  }

  return {
    event: eventName,
    matches,
    reasons,
    matchedFiles: pathResult.matchedFiles,
    evaluatedFilters
  };
}

function evaluateMergeGroupEvent(
  config: unknown,
  _changedPaths: string[],
  context: EventContext
): WorkflowTriggerEvaluation {
  const mgConfig = (config ?? {}) as Record<string, unknown>;
  const reasons: string[] = [];
  const typeFilters = extractStringArray(mgConfig.types);
  let matches = true;

  if (typeFilters.length) {
    const typesResult = evaluateTypesFilter(context.action, typeFilters);
    if (!typesResult.matches) {
      matches = false;
      reasons.push(typesResult.reason ?? '`types` filter did not include this event action.');
    }
  }

  return {
    event: 'merge_group',
    matches,
    reasons,
    matchedFiles: [],
    evaluatedFilters: {
      types: Boolean(typeFilters.length)
    }
  };
}

function manualTriggerEvaluation(event: string): WorkflowTriggerEvaluation {
  return {
    event,
    matches: false,
    reasons: ['Event requires manual invocation and does not respond to file changes.'],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}

function externalTriggerEvaluation(event: string, explanation: string): WorkflowTriggerEvaluation {
  return {
    event,
    matches: false,
    reasons: [explanation],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}

function genericTriggerEvaluation(event: string): WorkflowTriggerEvaluation {
  return {
    event,
    matches: false,
    reasons: ['Event runs independently of repository file changes.'],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}

function extractStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string') {
    return [value];
  }

  return [];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error as { status: number }).status === 404
  );
}
