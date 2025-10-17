package detector

import (
	"strings"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/nektos/act/pkg/model"
)

func matchingEvents(wf *model.Workflow, eventCtx EventContext, modifiedFiles []string) []string {
	var matched []string

	for _, evt := range wf.On() {
		if evt != eventCtx.Name {
			continue
		}

		config := parseEventConfig(wf.OnEvent(evt))
		if shouldTrigger(evt, config, eventCtx, modifiedFiles) {
			matched = append(matched, evt)
		}
	}

	return matched
}

type eventConfig struct {
	Branches       []string
	BranchesIgnore []string
	Paths          []string
	PathsIgnore    []string
	Tags           []string
	TagsIgnore     []string
	Types          []string
}

func parseEventConfig(raw interface{}) eventConfig {
	cfg := eventConfig{}
	if raw == nil {
		return cfg
	}

	switch v := raw.(type) {
	case map[string]interface{}:
		for k, val := range v {
			switch strings.ToLower(k) {
			case "branches":
				cfg.Branches = asStringSlice(val)
			case "branches-ignore":
				cfg.BranchesIgnore = asStringSlice(val)
			case "paths":
				cfg.Paths = asStringSlice(val)
			case "paths-ignore":
				cfg.PathsIgnore = asStringSlice(val)
			case "tags":
				cfg.Tags = asStringSlice(val)
			case "tags-ignore":
				cfg.TagsIgnore = asStringSlice(val)
			case "types":
				cfg.Types = asStringSlice(val)
			}
		}
	case []interface{}:
		cfg.Types = asStringSlice(v)
	case []string:
		cfg.Types = append(cfg.Types, v...)
	case string:
		cfg.Types = []string{strings.TrimSpace(v)}
	}

	return cfg
}

func shouldTrigger(event string, cfg eventConfig, ctx EventContext, files []string) bool {
	switch event {
	case "pull_request", "pull_request_target", "merge_group":
		if !matchesEventTypes(cfg.Types, ctx.Action) {
			return false
		}
		if !matchesBranchFilters(cfg.Branches, cfg.BranchesIgnore, ctx.BaseRef) {
			return false
		}
		if !matchesPaths(cfg.Paths, cfg.PathsIgnore, files) {
			return false
		}
		return true
	case "push":
		branch, tag := splitRef(ctx.Ref)
		if tag != "" {
			if !matchesPatternList(cfg.Tags, tag) {
				return false
			}
			if len(cfg.TagsIgnore) > 0 && matchesPatternList(cfg.TagsIgnore, tag) {
				return false
			}
		} else {
			if !matchesBranchFilters(cfg.Branches, cfg.BranchesIgnore, branch) {
				return false
			}
		}
		if !matchesPaths(cfg.Paths, cfg.PathsIgnore, files) {
			return false
		}
		return true
	default:
		if len(cfg.Types) == 0 {
			return true
		}
		return matchesEventTypes(cfg.Types, ctx.Action)
	}
}

func matchesEventTypes(types []string, action string) bool {
	if len(types) == 0 {
		return true
	}
	if action == "" {
		return false
	}
	for _, t := range types {
		if strings.EqualFold(strings.TrimSpace(t), action) {
			return true
		}
	}
	return false
}

func matchesBranchFilters(includes, excludes []string, branch string) bool {
	if len(includes) == 0 && len(excludes) == 0 {
		return true
	}
	if branch == "" {
		return false
	}

	if len(includes) > 0 && !matchesBranchPatternList(includes, branch) {
		return false
	}
	if len(excludes) > 0 && matchesBranchPatternList(excludes, branch) {
		return false
	}
	return true
}

func matchesPaths(includes, excludes, files []string) bool {
	if len(includes) == 0 && len(excludes) == 0 {
		return true
	}

	if len(includes) > 0 {
		for _, file := range files {
			if pathMatchesAny(includes, file) && !pathMatchesAny(excludes, file) {
				return true
			}
		}
		return false
	}

	// No include filters; ensure at least one file survives the excludes.
	if len(files) == 0 {
		return true
	}

	for _, file := range files {
		if !pathMatchesAny(excludes, file) {
			return true
		}
	}

	return false
}

func pathMatchesAny(patterns []string, path string) bool {
	for _, pattern := range patterns {
		normPattern := normalizePathPattern(pattern)
		if normPattern == "" {
			continue
		}
		match, err := doublestar.Match(normPattern, path)
		if err != nil {
			continue
		}
		if match {
			return true
		}
	}
	return false
}

func matchesPatternList(patterns []string, candidate string) bool {
	if len(patterns) == 0 {
		return true
	}

	for _, pattern := range patterns {
		norm := strings.TrimSpace(pattern)
		if norm == "" {
			continue
		}
		matched, err := doublestar.Match(norm, candidate)
		if err != nil {
			continue
		}
		if matched {
			return true
		}
	}

	return false
}

func matchesBranchPatternList(patterns []string, branch string) bool {
	if len(patterns) == 0 {
		return true
	}
	candidates := []string{branch}
	if !strings.HasPrefix(branch, "refs/heads/") && branch != "" {
		candidates = append(candidates, "refs/heads/"+branch)
	}

	for _, candidate := range candidates {
		if matchesPatternList(patterns, candidate) {
			return true
		}
	}
	return false
}
