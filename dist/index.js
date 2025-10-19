"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  run: () => run
});
module.exports = __toCommonJS(index_exports);
var core3 = __toESM(require("@actions/core"));
var github = __toESM(require("@actions/github"));

// src/changed-files.ts
var core = __toESM(require("@actions/core"));
var import_exec = require("@actions/exec");
async function getChangedFiles(options) {
  const { octokit, repository, baseRef, headRef, diffStrategy = "three-dot" } = options;
  const basehead = diffStrategy === "two-dot" ? `${baseRef}..${headRef}` : `${baseRef}...${headRef}`;
  const compareResponse = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: repository.owner,
    repo: repository.repo,
    basehead,
    per_page: 100
  });
  const payload = normalizeCompareResponse(compareResponse.data);
  const files = mapCompareResponse(payload);
  const totalFiles = typeof payload.total_files === "number" ? payload.total_files : files.length;
  const truncated = totalFiles > files.length || files.length >= 300;
  if (!truncated) {
    return {
      files,
      source: "api",
      truncated: false
    };
  }
  core.info(
    `Compare API returned ${files.length} files (possibly truncated). Falling back to local git diff for complete list.`
  );
  const fallbackFiles = await getFilesFromGit(baseRef, headRef, diffStrategy);
  return {
    files: fallbackFiles,
    source: "git",
    truncated: false
  };
}
function mapCompareResponse(data) {
  const entries = Array.isArray(data.files) ? data.files : [];
  const results = [];
  for (const entry of entries) {
    if (!isCompareFile(entry)) {
      continue;
    }
    const status = normalizeStatus(entry.status);
    const path = normalizePath(entry.filename);
    const previousPath = entry.previous_filename ? normalizePath(entry.previous_filename) : void 0;
    results.push({
      path,
      status,
      previousPath
    });
  }
  return results;
}
function normalizeCompareResponse(data) {
  if (typeof data !== "object" || data === null) {
    return {};
  }
  const record = data;
  return {
    files: Array.isArray(record.files) ? record.files : void 0,
    total_files: typeof record.total_files === "number" ? record.total_files : null
  };
}
async function getFilesFromGit(baseRef, headRef, diffStrategy) {
  const range = diffStrategy === "two-dot" ? `${baseRef}..${headRef}` : `${baseRef}...${headRef}`;
  const args = ["diff", "--name-status", range];
  const { stdout } = await (0, import_exec.getExecOutput)("git", args, { silent: true });
  const files = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const [statusToken, ...rest] = line.split("	");
    if (!statusToken) continue;
    if (statusToken.startsWith("R")) {
      const [previousPath, path2] = rest;
      if (!previousPath || !path2) {
        continue;
      }
      files.push({
        path: normalizePath(path2),
        previousPath: normalizePath(previousPath),
        status: "renamed"
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
function isCompareFile(file) {
  return typeof file === "object" && file !== null && typeof file.filename === "string";
}
function normalizeStatus(status) {
  switch (status) {
    case "added":
    case "A":
      return "added";
    case "modified":
    case "M":
      return "modified";
    case "removed":
    case "D":
      return "removed";
    case "renamed":
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}
function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

// src/workflows.ts
var core2 = __toESM(require("@actions/core"));
var import_workflow_parser = require("@actions/workflow-parser");
var import_node_buffer = require("buffer");

// src/patterns.ts
var import_picomatch = __toESM(require("picomatch"));
var PICOMATCH_OPTIONS = {
  dot: true,
  posixSlashes: true,
  nocase: false
};
function compilePattern(pattern) {
  const negate = pattern.startsWith("!");
  const source = negate ? pattern.slice(1) : pattern;
  return {
    pattern,
    negate,
    matcher: (0, import_picomatch.default)(source, PICOMATCH_OPTIONS)
  };
}
function compilePatterns(patterns = []) {
  return patterns.filter((pattern) => pattern.length > 0).map((pattern) => compilePattern(pattern));
}
function matchesCompiled(value, compiled) {
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
function evaluatePathFilters(files, includes, excludes) {
  const reasons = [];
  let considered = [...files];
  if (includes?.length) {
    const compiledIncludes = compilePatterns(includes);
    const included = considered.filter((file) => matchesCompiled(file, compiledIncludes));
    if (included.length === 0) {
      reasons.push("No changed files satisfied `paths` filter.");
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
    const ignored = /* @__PURE__ */ new Set();
    for (const file of considered) {
      if (matchesCompiled(file, compiledExcludes)) {
        ignored.add(file);
      }
    }
    if (ignored.size === considered.length) {
      reasons.push("All matching files were ignored by `paths-ignore` filter.");
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
function evaluateBranchFilters(branch, includes, excludes) {
  if (!branch) {
    return {
      matches: false,
      reason: "Branch information unavailable to evaluate filters."
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
function evaluateTagFilters(tag, includes, excludes) {
  if (!tag) {
    return {
      matches: false,
      reason: "Tag information unavailable to evaluate filters."
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
function evaluateTypesFilter(actualType, allowedTypes) {
  if (!allowedTypes?.length) {
    return { matches: true };
  }
  if (!actualType) {
    return {
      matches: false,
      reason: "Event type information unavailable to evaluate `types`."
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

// src/workflows.ts
async function assessWorkflows(options) {
  const { octokit, repository, ref, changedFiles, context: context2 } = options;
  const workflowFiles = await loadWorkflowFiles({ octokit, repository, ref });
  const pathSet = /* @__PURE__ */ new Set();
  for (const file of changedFiles) {
    pathSet.add(normalizePath2(file.path));
    if (file.previousPath) {
      pathSet.add(normalizePath2(file.previousPath));
    }
  }
  const changedPaths = Array.from(pathSet);
  const assessments = [];
  for (const file of workflowFiles) {
    const { template, errors } = await parseWorkflowFile(file);
    if (!template) {
      assessments.push({
        name: file.name,
        path: file.path,
        triggers: [],
        autoTriggered: false,
        errors
      });
      continue;
    }
    const triggers = evaluateWorkflowTriggers(template, changedPaths, context2);
    const autoTriggered = triggers.some((trigger) => trigger.matches);
    assessments.push({
      name: getTemplateName(template, file.name),
      path: file.path,
      triggers,
      autoTriggered,
      errors
    });
  }
  return assessments;
}
async function loadWorkflowFiles(options) {
  const { octokit, repository, ref } = options;
  const files = [];
  await traverse(".github/workflows");
  return files;
  async function traverse(path) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner: repository.owner,
        repo: repository.repo,
        path,
        ref
      });
      const data = response.data;
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (isFileEntry(entry) && isWorkflowFile(entry.name)) {
            const fileResponse = await octokit.rest.repos.getContent({
              owner: repository.owner,
              repo: repository.repo,
              path: entry.path,
              ref
            });
            const resolved = fileResponse.data;
            if (!isFileEntry(resolved) || typeof resolved.content !== "string") {
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
      } else if (isFileEntry(data) && typeof data.content === "string" && isWorkflowFile(data.name)) {
        files.push({
          name: data.name,
          path: data.path,
          content: decodeContent(data.content, data.encoding)
        });
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        core2.info(`No workflows found at ${path} for ref ${ref}.`);
        return;
      }
      throw error;
    }
  }
}
function isWorkflowFile(filename) {
  return filename.endsWith(".yml") || filename.endsWith(".yaml");
}
function decodeContent(content, encoding) {
  if (encoding !== "base64") {
    return content;
  }
  return import_node_buffer.Buffer.from(content, "base64").toString("utf8");
}
async function parseWorkflowFile(file) {
  const trace = new import_workflow_parser.NoOperationTraceWriter();
  const result = (0, import_workflow_parser.parseWorkflow)({ name: file.name, content: file.content }, trace);
  if (!result.value) {
    return {
      template: void 0,
      errors: ["Workflow failed to parse."]
    };
  }
  const template = await (0, import_workflow_parser.convertWorkflowTemplate)(result.context, result.value);
  const parseErrors = result.context.errors.getErrors().map((err) => err.message);
  const templateErrors = template.errors?.map((err) => err.Message) ?? [];
  return {
    template,
    errors: [...parseErrors, ...templateErrors]
  };
}
function getTemplateName(template, fallback) {
  const nameToken = template.name;
  const value = nameToken && typeof nameToken === "object" ? nameToken.value : void 0;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
function isDirectoryEntry(entry) {
  return typeof entry === "object" && entry !== null && entry.type === "dir" && typeof entry.path === "string";
}
function isFileEntry(entry) {
  return typeof entry === "object" && entry !== null && entry.type === "file" && typeof entry.name === "string" && typeof entry.path === "string";
}
function evaluateWorkflowTriggers(template, changedPaths, context2) {
  const triggers = [];
  if (!changedPaths.length) {
    return [
      {
        event: "unknown",
        matches: false,
        reasons: ["No changed files were provided for evaluation."],
        matchedFiles: [],
        evaluatedFilters: {}
      }
    ];
  }
  const events = template.events ?? {};
  for (const [eventName, config] of Object.entries(events)) {
    switch (eventName) {
      case "push":
        triggers.push(evaluatePushEvent(config, changedPaths, context2));
        break;
      case "pull_request":
        triggers.push(evaluatePullRequestEvent("pull_request", config, changedPaths, context2));
        break;
      case "pull_request_target":
        triggers.push(evaluatePullRequestEvent("pull_request_target", config, changedPaths, context2));
        break;
      case "merge_group":
        triggers.push(evaluateMergeGroupEvent(config, changedPaths, context2));
        break;
      case "workflow_dispatch":
        triggers.push(manualTriggerEvaluation(eventName));
        break;
      case "workflow_call":
        triggers.push(externalTriggerEvaluation(eventName, "Triggered by other workflows"));
        break;
      default:
        triggers.push(genericTriggerEvaluation(eventName));
        break;
    }
  }
  if (triggers.length === 0) {
    triggers.push({
      event: "none",
      matches: false,
      reasons: ["Workflow does not define any triggerable events."],
      matchedFiles: [],
      evaluatedFilters: {}
    });
  }
  return triggers;
}
function evaluatePushEvent(config, changedPaths, context2) {
  const pushConfig = config ?? {};
  const reasons = [];
  const evaluatedFilters = {};
  let matches = true;
  const branchFilters = {
    includes: extractStringArray(pushConfig.branches),
    excludes: extractStringArray(pushConfig["branches-ignore"])
  };
  const tagFilters = {
    includes: extractStringArray(pushConfig.tags),
    excludes: extractStringArray(pushConfig["tags-ignore"])
  };
  const pathFilters = {
    includes: extractStringArray(pushConfig.paths),
    excludes: extractStringArray(pushConfig["paths-ignore"])
  };
  const branchName = context2.branchName;
  const tagName = context2.tagName;
  if (branchFilters.includes.length || branchFilters.excludes.length) {
    evaluatedFilters.branches = true;
    const branchResult = evaluateBranchFilters(branchName, branchFilters.includes, branchFilters.excludes);
    if (!branchResult.matches) {
      matches = false;
      reasons.push(branchResult.reason ?? "Branch filter did not match.");
    }
  }
  if (tagName) {
    evaluatedFilters.tags = Boolean(tagFilters.includes.length || tagFilters.excludes.length);
    if (evaluatedFilters.tags) {
      const tagResult = evaluateTagFilters(tagName, tagFilters.includes, tagFilters.excludes);
      if (!tagResult.matches) {
        matches = false;
        reasons.push(tagResult.reason ?? "Tag filter did not match.");
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
    event: "push",
    matches,
    reasons,
    matchedFiles: pathResult.matchedFiles,
    evaluatedFilters
  };
}
function evaluatePullRequestEvent(eventName, config, changedPaths, context2) {
  const prConfig = config ?? {};
  const reasons = [];
  const evaluatedFilters = {};
  let matches = true;
  const branchFilters = {
    includes: extractStringArray(prConfig.branches),
    excludes: extractStringArray(prConfig["branches-ignore"])
  };
  const pathFilters = {
    includes: extractStringArray(prConfig.paths),
    excludes: extractStringArray(prConfig["paths-ignore"])
  };
  const typeFilters = extractStringArray(prConfig.types);
  if (branchFilters.includes.length || branchFilters.excludes.length) {
    evaluatedFilters.branches = true;
    const branchResult = evaluateBranchFilters(context2.baseBranch, branchFilters.includes, branchFilters.excludes);
    if (!branchResult.matches) {
      matches = false;
      reasons.push(branchResult.reason ?? "Base branch did not match filters.");
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
    const typesResult = evaluateTypesFilter(context2.action, typeFilters);
    if (!typesResult.matches) {
      matches = false;
      reasons.push(typesResult.reason ?? "`types` filter did not include this event action.");
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
function evaluateMergeGroupEvent(config, _changedPaths, context2) {
  const mgConfig = config ?? {};
  const reasons = [];
  const typeFilters = extractStringArray(mgConfig.types);
  let matches = true;
  if (typeFilters.length) {
    const typesResult = evaluateTypesFilter(context2.action, typeFilters);
    if (!typesResult.matches) {
      matches = false;
      reasons.push(typesResult.reason ?? "`types` filter did not include this event action.");
    }
  }
  return {
    event: "merge_group",
    matches,
    reasons,
    matchedFiles: [],
    evaluatedFilters: {
      types: Boolean(typeFilters.length)
    }
  };
}
function manualTriggerEvaluation(event) {
  return {
    event,
    matches: false,
    reasons: ["Event requires manual invocation and does not respond to file changes."],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}
function externalTriggerEvaluation(event, explanation) {
  return {
    event,
    matches: false,
    reasons: [explanation],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}
function genericTriggerEvaluation(event) {
  return {
    event,
    matches: false,
    reasons: ["Event runs independently of repository file changes."],
    matchedFiles: [],
    evaluatedFilters: {}
  };
}
function extractStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}
function normalizePath2(path) {
  return path.replace(/\\/g, "/");
}
function isNotFoundError(error) {
  return Boolean(
    typeof error === "object" && error !== null && "status" in error && error.status === 404
  );
}

// src/index.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function getNestedValue(source, path) {
  let current = source;
  for (const segment of path) {
    if (!isRecord(current)) {
      return void 0;
    }
    current = current[segment];
  }
  return current;
}
function getNestedString(source, path) {
  const value = getNestedValue(source, path);
  return typeof value === "string" ? value : null;
}
async function run() {
  const token = core3.getInput("github-token", { required: true });
  const repoInput = core3.getInput("repository");
  const baseRefInput = core3.getInput("base-ref");
  const headRefInput = core3.getInput("head-ref");
  const workflowRefInput = core3.getInput("workflow-ref");
  const eventNameInput = core3.getInput("event-name");
  const refInput = core3.getInput("ref");
  const baseBranchInput = core3.getInput("base-branch");
  const headBranchInput = core3.getInput("head-branch");
  const actionInput = core3.getInput("pull-request-action");
  const diffStrategyInput = (core3.getInput("diff-strategy") || "auto").toLowerCase();
  const context2 = github.context;
  const repository = resolveRepository(repoInput, context2);
  const baseRef = resolveBaseRef(baseRefInput, context2);
  const headRef = resolveHeadRef(headRefInput, context2);
  const workflowRef = workflowRefInput ?? headRef;
  if (!baseRef || !headRef) {
    throw new Error("Both `base-ref` and `head-ref` must be provided or derivable from the event context.");
  }
  if (!workflowRef) {
    throw new Error("Unable to determine the ref to inspect workflows against.");
  }
  const diffStrategy = resolveDiffStrategy(diffStrategyInput, context2.eventName ?? "");
  const octokit = github.getOctokit(token);
  const changedFiles = await getChangedFiles({
    octokit,
    repository,
    baseRef,
    headRef,
    diffStrategy
  });
  const eventContext = buildEventContext({
    context: context2,
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
  core3.setOutput("changed-files", JSON.stringify(changedFiles.files));
  core3.setOutput("triggered-workflows", JSON.stringify(triggeredWorkflows));
  core3.setOutput("report", JSON.stringify(report));
  await writeSummary({
    assessments,
    changedFilesCount: changedFiles.files.length,
    triggeredCount: triggeredWorkflows.length
  });
}
function buildEventContext(options) {
  const { context: context2, refOverride, eventNameOverride, baseBranchOverride, headBranchOverride, actionOverride } = options;
  const payload = context2.payload;
  const ref = refOverride ?? context2.ref ?? null;
  const eventName = eventNameOverride ?? context2.eventName ?? "push";
  const baseBranch = baseBranchOverride ?? getNestedString(payload, ["pull_request", "base", "ref"]) ?? getNestedString(payload, ["merge_group", "base_ref"]) ?? getNestedString(payload, ["workflow_run", "head_branch"]) ?? null;
  const headBranch = headBranchOverride ?? getNestedString(payload, ["pull_request", "head", "ref"]) ?? getNestedString(payload, ["merge_group", "head_ref"]) ?? null;
  const actionValue = actionOverride ?? getNestedString(payload, ["action"]);
  const action = actionValue ?? void 0;
  const refName = ref === null ? null : ref.replace(/^refs\//, "");
  const branchName = ref === null ? null : ref.startsWith("refs/heads/") ? ref.replace(/^refs\/heads\//, "") : ref;
  const tagName = ref !== null && ref.startsWith("refs/tags/") ? ref.replace(/^refs\/tags\//, "") : null;
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
function resolveRepository(repoInput, context2) {
  if (repoInput) {
    const [owner, repo] = repoInput.split("/");
    if (!owner || !repo) {
      throw new Error('`repository` input must be in the form "owner/repo".');
    }
    return { owner, repo };
  }
  if (!context2.repo?.owner || !context2.repo?.repo) {
    throw new Error("Unable to determine repository from context.");
  }
  return { owner: context2.repo.owner, repo: context2.repo.repo };
}
function resolveBaseRef(baseRefInput, context2) {
  if (baseRefInput) {
    return baseRefInput;
  }
  const payload = context2.payload;
  if (context2.eventName === "pull_request" || context2.eventName === "pull_request_target") {
    return getNestedString(payload, ["pull_request", "base", "sha"]);
  }
  if (context2.eventName === "push") {
    return getNestedString(payload, ["before"]);
  }
  return null;
}
function resolveHeadRef(headRefInput, context2) {
  if (headRefInput) {
    return headRefInput;
  }
  const payload = context2.payload;
  if (context2.eventName === "pull_request" || context2.eventName === "pull_request_target") {
    return getNestedString(payload, ["pull_request", "head", "sha"]);
  }
  const sha = context2.sha;
  return sha ?? null;
}
function resolveDiffStrategy(strategy, eventName) {
  if (strategy === "two-dot" || strategy === "three-dot") {
    return strategy;
  }
  if (eventName === "push") {
    return "two-dot";
  }
  return "three-dot";
}
async function writeSummary(options) {
  const { assessments, changedFilesCount, triggeredCount } = options;
  core3.summary.addHeading("Workflow Trigger Assessment", 2);
  core3.summary.addRaw(`Changed files analysed: **${changedFilesCount}**
`);
  core3.summary.addRaw(`Workflows automatically triggered: **${triggeredCount}**

`);
  if (assessments.length) {
    core3.summary.addTable([
      ["Workflow", "Triggered", "Reasons / Matched Files"],
      ...assessments.map((assessment) => [
        assessment.name,
        assessment.autoTriggered ? "Yes" : "No",
        assessment.triggers.map((trigger) => {
          const status = trigger.matches ? "\u2705" : "\u274C";
          if (trigger.matches) {
            return `${status} ${trigger.event}`;
          }
          const reason = trigger.reasons.join("; ") || "Not triggered";
          return `${status} ${trigger.event}: ${reason}`;
        }).join("\n")
      ])
    ]);
  }
  await core3.summary.write();
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  run().catch((error) => {
    if (error instanceof Error) {
      core3.setFailed(error.message);
    } else {
      core3.setFailed("Unknown error occurred.");
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  run
});
//# sourceMappingURL=index.js.map