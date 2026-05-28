# Documentation Process

Documentation should be updated as part of normal development, not after everything is finished.

## What To Update

When adding a user-facing feature:

- Update `README.md` if the feature changes the main product capability list.
- Update `docs/DEVELOPMENT_LOG.md` with the date and summary.
- Update `docs/ROADMAP.md` if the feature completes, changes, or creates roadmap work.

When changing code structure:

- Update `docs/ARCHITECTURE.md`.
- Explain what moved and why.
- Mention any remaining cleanup work.

When fixing a bug:

- Add a short entry to `docs/DEVELOPMENT_LOG.md`.
- Include the user-visible behavior that changed.

## Commit Style

Documentation can be committed with the related feature or in a separate docs commit.

Good commit examples:

```text
document graph workspace architecture
update development log for 3d cube tools
document capture and restore workflow
```

## Pull Request Notes

Each pull request should mention:

- what changed
- why it changed
- how it was tested
- whether documentation was updated

