export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface ChangedFile {
  path: string;
  status: FileStatus;
  previousPath?: string;
}

export interface EventContext {
  ref: string | null;
  refName: string | null;
  branchName: string | null;
  tagName: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  eventName: string;
  action?: string;
}

export interface WorkflowTriggerEvaluation {
  event: string;
  matches: boolean;
  reasons: string[];
  matchedFiles: string[];
  evaluatedFilters: {
    branches?: boolean;
    paths?: boolean;
    tags?: boolean;
    types?: boolean;
  };
}

export interface WorkflowAssessment {
  name: string;
  path: string;
  triggers: WorkflowTriggerEvaluation[];
  autoTriggered: boolean;
  errors: string[];
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}
