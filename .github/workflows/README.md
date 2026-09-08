# GitHub Actions disabled

All workflows are disabled by appending `.disabled` to their filenames.
GitHub Actions only loads workflow files ending in `.yml` or `.yaml`.

To restore a workflow, remove the `.disabled` suffix from its filename.
Workflows that call other workflows require those dependencies to be restored too.
