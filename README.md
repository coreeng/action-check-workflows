# Workflow Trigger Inspector

This reusable GitHub Action examines every workflow stored under `.github/workflows/` in the checked
out repository (the pull request head) and reports which ones would be triggered for the current pull
request and the set of modified files. The focus is on `pull_request` events: the action evaluates the
workflows exactly as they exist in the PR branch.

The action parses workflow YAML using the open source [`nektos/act`](https://github.com/nektos/act)
parser so that event filters such as `paths`, `paths-ignore`, `branches`, and `tags` are
interpreted in a GitHub-compatible way.

## Inputs

| Name | Required | Description |
| ---- | -------- | ----------- |
| `modified-files` | ✅ | List of changed file paths. Accepts a newline-separated string or a JSON array (`["src/main.go","pkg/util.go"]`). Paths should be relative to the repository root. |

## Outputs

| Name | Description |
| ---- | ----------- |
| `workflows` | JSON array of the workflows that should run. Each entry includes the workflow name, path, and the matching event (e.g. `[{ "name": "ci", "path": ".github/workflows/ci.yml", "events": ["pull_request"] }]`). |
| `count` | Number of workflows that matched. |

## Example Usage

```yaml
jobs:
  determine-workflows:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Gather changed files
        id: changes
        run: |
          git fetch origin "$GITHUB_BASE_REF"
          files=$(git diff --name-only "origin/$GITHUB_BASE_REF"...HEAD)
          printf 'files<<EOF\n%s\nEOF\n' "$files" >> "$GITHUB_OUTPUT"

      - name: Detect workflows
        id: detect
        uses: ./ # or use the published action reference
        with:
          modified-files: ${{ steps.changes.outputs.files }}

      - name: Show results
        run: |
          echo "Triggered workflows:"
          echo '${{ steps.detect.outputs.workflows }}'
```

When used in pull request workflows, supply the list of files that differ between the PR head
and base (for example via `git diff --name-only` or the `actions/github-script` API).

## Development

```bash
go test ./...
```

The unit test suite exercises path filtering, branch filtering, tag filtering, and event type
edge cases. The action itself can be run locally via:

```bash
docker build -t workflow-trigger-inspector .
docker run --rm \
  -e GITHUB_EVENT_NAME=pull_request \
  -e GITHUB_BASE_REF=main \
  -e INPUT_MODIFIED_FILES='["src/main.go"]' \
  -v "$(pwd)":/workspace \
  -w /workspace \
  workflow-trigger-inspector
```

## License

This project is licensed under the MIT License.
