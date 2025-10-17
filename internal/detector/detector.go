package detector

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nektos/act/pkg/model"
)

// WorkflowMatch represents a workflow whose trigger configuration matches the
// provided event context and modified files.
type WorkflowMatch struct {
	Name   string
	Path   string
	Events []string
}

// DetectTriggeredWorkflows scans the repository rooted at repoRoot for GitHub
// workflow files and returns the ones that should trigger for the supplied
// event context and modified files.
func DetectTriggeredWorkflows(repoRoot string, eventCtx EventContext, modifiedFiles []string) ([]WorkflowMatch, error) {
	if eventCtx.Name == "" {
		return nil, errors.New("event name is required")
	}

	defs, err := loadWorkflowDefinitions(repoRoot)
	if err != nil {
		return nil, err
	}

	normFiles := normalizePaths(modifiedFiles)

	var matches []WorkflowMatch
	for _, def := range defs {
		workflow, err := readWorkflow(bytes.NewReader(def.Content))
		if err != nil {
			return nil, fmt.Errorf("parse workflow %s: %w", def.Path, err)
		}

		events := matchingEvents(workflow, eventCtx, normFiles)
		if len(events) == 0 {
			continue
		}

		name := workflowName(workflow, filepath.Base(def.Path))
		match := WorkflowMatch{
			Name:   name,
			Path:   filepath.ToSlash(def.Path),
			Events: events,
		}
		matches = append(matches, match)
	}

	return matches, nil
}

func readWorkflow(r io.Reader) (*model.Workflow, error) {
	wf, err := model.ReadWorkflow(r, false)
	if err != nil {
		return nil, err
	}
	return wf, nil
}

func isWorkflowFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".yml") || strings.HasSuffix(lower, ".yaml")
}

func workflowName(workflow *model.Workflow, fallback string) string {
	if workflow.Name != "" {
		return workflow.Name
	}
	return strings.TrimSuffix(strings.TrimSuffix(fallback, ".yml"), ".yaml")
}

type workflowDefinition struct {
	Path    string
	Content []byte
}

func loadWorkflowDefinitions(repoRoot string) ([]workflowDefinition, error) {
	workflowsDir := filepath.Join(repoRoot, ".github", "workflows")
	if _, err := os.Stat(workflowsDir); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read workflows directory: %w", err)
	}

	var defs []workflowDefinition
	err := filepath.WalkDir(workflowsDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if !isWorkflowFile(d.Name()) {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read workflow %s: %w", path, err)
		}
		rel, err := filepath.Rel(repoRoot, path)
		if err != nil {
			return fmt.Errorf("derive relative path for %s: %w", path, err)
		}
		defs = append(defs, workflowDefinition{
			Path:    filepath.ToSlash(rel),
			Content: content,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	return defs, nil
}
