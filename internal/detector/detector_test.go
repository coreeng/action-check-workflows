package detector

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/google/go-cmp/cmp"
)

func TestDetectTriggeredWorkflows_PullRequestFilters(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "pr-check.yml", `
name: pull-request-check
on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]
    paths:
      - "src/**"
`)

	writeWorkflow(t, repo, "docs-check.yml", `
name: docs-check
on:
  pull_request:
    paths:
      - "docs/**"
`)

	ctx := EventContext{
		Name:    "pull_request",
		Action:  "opened",
		BaseRef: "main",
	}

	modified := []string{"src/main.go"}

	matches, err := DetectTriggeredWorkflows(repo, ctx, modified)
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}

	want := []WorkflowMatch{
		{
			Name:   "pull-request-check",
			Path:   ".github/workflows/pr-check.yml",
			Events: []string{"pull_request"},
		},
	}

	if diff := cmp.Diff(want, matches); diff != "" {
		t.Fatalf("mismatch (-want +got):\n%s", diff)
	}
}

func TestDetectTriggeredWorkflows_PathIgnores(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "path-ignore.yml", `
name: filtered
on:
  pull_request:
    paths-ignore:
      - "docs/**"
`)

	ctx := EventContext{
		Name:    "pull_request",
		Action:  "synchronize",
		BaseRef: "main",
	}

	onlyDocs := []string{"docs/README.md"}
	matches, err := DetectTriggeredWorkflows(repo, ctx, onlyDocs)
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no matches when only ignored paths change, got %v", matches)
	}

	withSource := []string{"docs/README.md", "pkg/config.go"}
	matches, err = DetectTriggeredWorkflows(repo, ctx, withSource)
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected a match when a non-ignored file changes, got %v", matches)
	}
}

func TestDetectTriggeredWorkflows_PushTags(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "release.yml", `
name: release
on:
  push:
    tags: ["v*"]
`)

	ctx := EventContext{
		Name: "push",
		Ref:  "refs/tags/v1.2.3",
	}

	matches, err := DetectTriggeredWorkflows(repo, ctx, []string{"CHANGELOG.md"})
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected release workflow to match, got %v", matches)
	}
}

func TestDetectTriggeredWorkflows_EventTypes(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "pr-closed.yml", `
name: pr-closed
on:
  pull_request:
    types: [closed]
`)

	ctx := EventContext{
		Name:    "pull_request",
		Action:  "opened",
		BaseRef: "main",
	}

	matches, err := DetectTriggeredWorkflows(repo, ctx, []string{"src/main.go"})
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no matches for mismatched action, got %v", matches)
	}
}

func TestDetectTriggeredWorkflows_WorkflowDispatch(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "manual.yml", `
name: manual
on:
  workflow_dispatch:
`)

	ctx := EventContext{
		Name: "workflow_dispatch",
	}

	matches, err := DetectTriggeredWorkflows(repo, ctx, nil)
	if err != nil {
		t.Fatalf("DetectTriggeredWorkflows returned error: %v", err)
	}

	want := []WorkflowMatch{
		{
			Name:   "manual",
			Path:   ".github/workflows/manual.yml",
			Events: []string{"workflow_dispatch"},
		},
	}

	if diff := cmp.Diff(want, matches); diff != "" {
		t.Fatalf("mismatch (-want +got):\n%s", diff)
	}
}

func TestShouldTriggerPaths(t *testing.T) {
	cfg := eventConfig{
		Paths: []string{"src/**"},
	}
	ctx := EventContext{
		Name:    "pull_request",
		Action:  "opened",
		BaseRef: "main",
	}
	if !shouldTrigger("pull_request", cfg, ctx, []string{"src/main.go"}) {
		t.Fatalf("expected pull_request to trigger when paths match")
	}
	if shouldTrigger("pull_request", cfg, ctx, []string{"docs/readme.md"}) {
		t.Fatalf("expected pull_request to skip when paths do not match")
	}
}

func TestMatchingEvents(t *testing.T) {
	repo := t.TempDir()
	writeWorkflow(t, repo, "match.yml", `
name: match
on:
  pull_request:
    paths: ["src/**"]
`)

	path := filepath.Join(repo, ".github", "workflows", "match.yml")
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open workflow: %v", err)
	}
	defer f.Close()

	wf, err := readWorkflow(f)
	if err != nil {
		t.Fatalf("read workflow: %v", err)
	}

	events := matchingEvents(wf, EventContext{
		Name:    "pull_request",
		Action:  "opened",
		BaseRef: "main",
	}, []string{"src/main.go"})

	if len(events) != 1 {
		t.Fatalf("expected a matching event, got %v", events)
	}
}

func writeWorkflow(t *testing.T, repoRoot, name, content string) {
	t.Helper()
	dir := filepath.Join(repoRoot, ".github", "workflows")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create workflows dir: %v", err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(strings.TrimLeft(content, "\n")), 0o644); err != nil {
		t.Fatalf("failed to write workflow %s: %v", name, err)
	}
}
func TestNormalizePaths(t *testing.T) {
	paths := normalizePaths([]string{"src/main.go", "./src/utils.go", "/docs/readme.md"})
	want := []string{"src/main.go", "src/utils.go", "docs/readme.md"}
	if diff := cmp.Diff(want, paths); diff != "" {
		t.Fatalf("normalizePaths mismatch (-want +got):\n%s", diff)
	}
}
func TestBranchPatternMatch(t *testing.T) {
	matched, err := doublestar.Match("main", "main")
	if err != nil {
		t.Fatalf("match returned error: %v", err)
	}
	if !matched {
		t.Fatalf("expected pattern to match")
	}
}
func TestMatchesBranchPatternList(t *testing.T) {
	if !matchesBranchPatternList([]string{"main"}, "main") {
		t.Fatalf("expected branch pattern to match")
	}
	if matchesBranchPatternList([]string{"release/**"}, "main") {
		t.Fatalf("expected branch pattern not to match")
	}
}
