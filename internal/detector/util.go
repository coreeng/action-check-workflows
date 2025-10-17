package detector

import (
	"fmt"
	"path/filepath"
	"strings"
)

func normalizePaths(files []string) []string {
	out := make([]string, 0, len(files))
	seen := map[string]struct{}{}
	for _, file := range files {
		norm := normalizePathPattern(file)
		if norm == "" {
			continue
		}
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		out = append(out, norm)
	}
	return out
}

func normalizePathPattern(p string) string {
	if p == "" {
		return ""
	}
	norm := filepath.ToSlash(strings.TrimSpace(p))
	for strings.HasPrefix(norm, "./") {
		norm = strings.TrimPrefix(norm, "./")
	}
	for strings.HasPrefix(norm, "/") {
		norm = strings.TrimPrefix(norm, "/")
	}
	return norm
}

func asStringSlice(value interface{}) []string {
	switch v := value.(type) {
	case nil:
		return nil
	case []string:
		return append([]string(nil), v...)
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if item == nil {
				continue
			}
			out = append(out, fmt.Sprint(item))
		}
		return out
	case string:
		return []string{strings.TrimSpace(v)}
	default:
		return []string{fmt.Sprint(v)}
	}
}

func splitRef(ref string) (branch string, tag string) {
	if strings.HasPrefix(ref, "refs/heads/") {
		return strings.TrimPrefix(ref, "refs/heads/"), ""
	}
	if strings.HasPrefix(ref, "refs/tags/") {
		return "", strings.TrimPrefix(ref, "refs/tags/")
	}
	return strings.TrimSpace(ref), ""
}
