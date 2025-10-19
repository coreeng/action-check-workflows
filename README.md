# Actions Check Workflows

Reusable JavaScript action that cross-references repository changes against every workflow in `.github/workflows` to determine which workflows will run automatically. It compares two git references, evaluates branch and path filters using `picomatch`, and reports the workflows whose triggers match the supplied changes.

## Inputs

| Name | Required | Description |
| --- | --- | --- |
| `github-token` | ✅ | Token with `repo` scope (typically `${{ secrets.GITHUB_TOKEN }}`) used for compare and content API calls. |
| `repository` | ❌ | Repository in `owner/name` form. Defaults to the current repository. |
| `base-ref` | ❌ | Base commit SHA for comparisons. Falls back to the event payload when omitted. |
| `head-ref` | ❌ | Head commit SHA for comparisons. Defaults to the triggering commit/PR head. |
| `workflow-ref` | ❌ | Git ref used to load workflows. Defaults to `head-ref`. |
| `event-name` | ❌ | Override the GitHub event name used for evaluation. |
| `ref` | ❌ | Override ref used for branch evaluation (e.g. `refs/heads/main`). |
| `base-branch` | ❌ | Override base branch for pull request style events. |
| `head-branch` | ❌ | Override head branch for pull request style events. |
| `pull-request-action` | ❌ | Override pull request action (e.g. `synchronize`, `opened`). |
| `diff-strategy` | ❌ | Diff mode: `auto` (default), `two-dot`, or `three-dot`. |

## Outputs

| Name | Description |
| --- | --- |
| `changed-files` | JSON array describing every changed file (path, status, `previousPath` for renames). |
| `triggered-workflows` | JSON array of workflow assessments that evaluated to `autoTriggered = true`. |
| `report` | Complete JSON report containing inputs, changed files, and every workflow assessment. |

## Usage

```yaml
jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/actions-check-workflows@v1
        id: inspector
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base-ref: ${{ github.event.pull_request.base.sha }}
          head-ref: ${{ github.event.pull_request.head.sha }}
      - run: echo "Workflows => ${{ steps.inspector.outputs.triggered-workflows }}"
```

## Development

- Node.js 22 is recommended for local work. Install dependencies with `npm install`.
- Useful scripts:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`

The action is bundled with `tsup`; the compiled files in `dist/` should be committed when publishing updates.

## Release

1. Update the changelog (if applicable) and run `npm run build`.
2. Commit the generated `dist/` output.
3. Use the provided `publish.yml` workflow to create a tagged release or manually push a tag.
