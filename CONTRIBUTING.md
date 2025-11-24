# Contributing

This repository is a maintained fork of [QuickJS](https://bellard.org/quickjs/) with additional debugger support and examples.

The goals are:

- Track upstream QuickJS closely.
- Keep debugger support working as upstream evolves.
- Validate changes with the existing test suite and CI.

## Repository layout

- `upstream-main`: pristine branch that tracks `upstream/master` (unmodified QuickJS).
- `debugger`: long‑lived feature branch that contains debugger support and related tooling/examples.
- `sync-upstream.sh`: helper script to pull in upstream changes, rebase `debugger`, rebuild, and run tests.

## Remotes

When working with a local clone of this repository, the expected remote setup is:

- `origin` – this debugger-enabled QuickJS fork on GitHub (where you cloned from).
- `upstream` – Fabrice Bellard's official QuickJS repository
  - e.g. `https://github.com/bellard/quickjs.git`

You can confirm your local configuration with:


```bash
git remote -v
```

If you cloned your own fork first and don't yet have `upstream`:

```bash
git remote add upstream https://github.com/bellard/quickjs.git
```

## Keeping in sync with upstream QuickJS

The main workflow for tracking new QuickJS releases is:

1. Ensure remotes and branches exist:

   - `upstream` remote points to Bellard's repo.
   - `upstream-main` branch exists and tracks `upstream/master`.
   - `debugger` branch contains debugger changes.

   If `upstream-main` does not yet exist, it will be created by the script on first run.

2. From the repository root, run:

   ```bash
   UPSTREAM_REMOTE=upstream FEATURE_BRANCH=debugger ./sync-upstream.sh
   ```

   This script will:

   - Fetch from `UPSTREAM_REMOTE` (default: `upstream`).
   - Update or create `upstream-main` from `UPSTREAM_REMOTE/master` (or `UPSTREAM_BRANCH` if overridden).
   - Check out `FEATURE_BRANCH` (default: `debugger`).
   - Rebase `FEATURE_BRANCH` onto `upstream-main`.
   - Run `make -j"$(nproc)"` and `make test`.

3. If there are rebase conflicts:

   - Resolve them in the usual Git way, e.g.:

     ```bash
     # edit files
     git add <resolved-files>
     git rebase --continue
     ```

   - After the rebase completes, if `sync-upstream.sh` was interrupted, run:

     ```bash
     make -j"$(nproc)"
     make test
     ```

4. When everything is green, push the updated `debugger` branch:

   ```bash
   git push origin debugger
   ```

## Running tests locally

Basic build and test:

```bash
make -j"$(nproc)"
make test
```

Additional useful targets (from upstream QuickJS):

- `make microbench` – micro benchmarks.
- `make test2-bootstrap && make test2` – run the test262 suite (slow, but thorough).

## Continuous Integration

GitHub Actions is configured in `.github/workflows/ci.yml` to run on pushes and pull requests. It:

- Builds and tests on Linux (several variants), macOS, FreeBSD, and a Cosmopolitan build.
- Runs the built‑in tests (`make test`), microbenchmarks, and test262 in relevant jobs.

When you push to `debugger` or open a PR, CI should automatically run and serve as the main compatibility and regression check.

## Making changes

1. Start from `debugger`:

   ```bash
   git checkout debugger
   git pull --rebase origin debugger
   ```

2. Create a feature branch off `debugger` if desired:

   ```bash
   git checkout -b my-feature-branch
   ```

3. Make changes, then build and test locally:

   ```bash
   make -j"$(nproc)"
   make test
   ```

4. Push your branch and open a pull request against `debugger` on GitHub.

## Notes on debugger code

- Debugger support lives in modifications to the core VM (`quickjs.c`, `quickjs.h`, `quickjs-opcode.h`, etc.) and in tests/examples such as:
  - `test-debugger.js`, `test-debugger-adv.js`
  - `examples/browser-debugger/`
  - `examples/wasm-debug/`
- When updating for new upstream releases, prefer small, localized changes and use feature flags or clear separation where possible to keep merge conflict resolution manageable.
