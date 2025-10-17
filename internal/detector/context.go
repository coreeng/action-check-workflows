package detector

// EventContext captures the minimum information required to evaluate
// GitHub Actions workflow triggers against the current run context.
type EventContext struct {
	// Name is the GitHub event name, e.g. "pull_request" or "push".
	Name string

	// Action is the event subtype for events that support "types" filters.
	// For example "opened", "synchronize", or "closed" for pull requests.
	Action string

	// Ref is the git ref associated with the event, e.g. "refs/heads/main".
	Ref string

	// BaseRef is the base branch for pull request style events.
	BaseRef string

	// HeadRef is the source branch for pull request style events.
	HeadRef string

	// DefaultBranch is the repository default branch, when known.
	DefaultBranch string
}
