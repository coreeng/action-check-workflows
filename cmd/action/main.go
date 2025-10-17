package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/coreeng/action-check-workflows/internal/detector"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	modified, err := parseModifiedFiles(os.Getenv("INPUT_MODIFIED_FILES"))
	if err != nil {
		return fmt.Errorf("parse modified files: %w", err)
	}

	eventCtx, err := buildEventContext()
	if err != nil {
		return fmt.Errorf("build event context: %w", err)
	}

	repoRoot := workspaceRoot()

	matches, err := detector.DetectTriggeredWorkflows(repoRoot, eventCtx, modified)
	if err != nil {
		return err
	}

	if len(matches) == 0 {
		fmt.Println("No workflows match the current event and modified files.")
	} else {
		fmt.Printf("Detected %d workflows to run:\n", len(matches))
		for _, wf := range matches {
			fmt.Printf(" - %s (%s) via %s\n", wf.Name, wf.Path, strings.Join(wf.Events, ", "))
		}
	}

	if err := exportOutputs(matches); err != nil {
		return fmt.Errorf("export outputs: %w", err)
	}

	return nil
}

func parseModifiedFiles(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}

	if strings.HasPrefix(raw, "[") {
		var values []string
		if err := json.Unmarshal([]byte(raw), &values); err != nil {
			return nil, err
		}
		return values, nil
	}

	var parts []string
	for _, segment := range strings.Split(raw, "\n") {
		fields := strings.FieldsFunc(segment, func(r rune) bool {
			return r == ',' || r == '\n'
		})
		for _, f := range fields {
			if trimmed := strings.TrimSpace(f); trimmed != "" {
				parts = append(parts, trimmed)
			}
		}
	}

	return parts, nil
}

func workspaceRoot() string {
	if root := os.Getenv("GITHUB_WORKSPACE"); root != "" {
		return root
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "."
}

func buildEventContext() (detector.EventContext, error) {
	name := strings.TrimSpace(os.Getenv("GITHUB_EVENT_NAME"))
	if name == "" {
		return detector.EventContext{}, errors.New("GITHUB_EVENT_NAME is not set")
	}

	ctx := detector.EventContext{
		Name:          name,
		Ref:           strings.TrimSpace(os.Getenv("GITHUB_REF")),
		BaseRef:       strings.TrimSpace(os.Getenv("GITHUB_BASE_REF")),
		HeadRef:       strings.TrimSpace(os.Getenv("GITHUB_HEAD_REF")),
		DefaultBranch: strings.TrimSpace(os.Getenv("GITHUB_DEFAULT_BRANCH")),
	}

	payloadPath := strings.TrimSpace(os.Getenv("GITHUB_EVENT_PATH"))
	if payloadPath != "" {
		if data, err := os.ReadFile(payloadPath); err == nil {
			populateContextFromPayload(&ctx, data)
		}
	}

	return ctx, nil
}

func populateContextFromPayload(ctx *detector.EventContext, payload []byte) {
	type basePayload struct {
		Action     string `json:"action"`
		Repository struct {
			DefaultBranch string `json:"default_branch"`
		} `json:"repository"`
	}
	var base basePayload
	if err := json.Unmarshal(payload, &base); err == nil {
		if base.Action != "" {
			ctx.Action = base.Action
		}
		if base.Repository.DefaultBranch != "" {
			ctx.DefaultBranch = base.Repository.DefaultBranch
		}
	}

	switch ctx.Name {
	case "pull_request", "pull_request_target":
		var pr struct {
			Action      string `json:"action"`
			PullRequest struct {
				Base struct {
					Ref string `json:"ref"`
				} `json:"base"`
				Head struct {
					Ref string `json:"ref"`
				} `json:"head"`
			} `json:"pull_request"`
		}
		if err := json.Unmarshal(payload, &pr); err == nil {
			if pr.Action != "" {
				ctx.Action = pr.Action
			}
			if pr.PullRequest.Base.Ref != "" {
				ctx.BaseRef = pr.PullRequest.Base.Ref
			}
			if pr.PullRequest.Head.Ref != "" {
				ctx.HeadRef = pr.PullRequest.Head.Ref
			}
		}
	case "merge_group":
		var mg struct {
			MergeGroup struct {
				BaseRef string `json:"base_ref"`
				HeadRef string `json:"head_ref"`
			} `json:"merge_group"`
		}
		if err := json.Unmarshal(payload, &mg); err == nil {
			if mg.MergeGroup.BaseRef != "" {
				ctx.BaseRef = mg.MergeGroup.BaseRef
			}
			if mg.MergeGroup.HeadRef != "" {
				ctx.HeadRef = mg.MergeGroup.HeadRef
			}
		}
	case "push":
		var push struct {
			Ref string `json:"ref"`
		}
		if err := json.Unmarshal(payload, &push); err == nil && push.Ref != "" {
			ctx.Ref = push.Ref
		}
	}
}

func exportOutputs(matches []detector.WorkflowMatch) error {
	type output struct {
		Name   string   `json:"name"`
		Path   string   `json:"path"`
		Events []string `json:"events"`
	}

	summary := make([]output, 0, len(matches))
	for _, m := range matches {
		summary = append(summary, output{
			Name:   m.Name,
			Path:   filepath.ToSlash(m.Path),
			Events: append([]string(nil), m.Events...),
		})
	}

	blob, err := json.Marshal(summary)
	if err != nil {
		return err
	}

	if err := setOutput("workflows", string(blob)); err != nil {
		return err
	}
	return setOutput("count", fmt.Sprintf("%d", len(matches)))
}

func setOutput(name, value string) error {
	path := os.Getenv("GITHUB_OUTPUT")
	if path == "" {
		return nil
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o666)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := fmt.Fprintf(f, "%s<<EOF\n%s\nEOF\n", name, value); err != nil {
		return err
	}
	return nil
}
