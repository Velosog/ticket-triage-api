# Security Policy

Ticket Triage API is a portfolio project. It is not deployed as a public
service, but security reports are welcome and taken seriously.

## Supported versions

Only the latest release on the `main` branch receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue or pull request for a security problem.

Report it privately to the repository owner, either through GitHub's
"Report a vulnerability" button (Security tab) or through the owner's GitHub
profile: <https://github.com/Velosog>

Include:

- the affected endpoint, file or commit;
- steps to reproduce (a minimal request is ideal);
- the impact you expect (data exposure between clients, budget bypass,
  prompt injection that changes stored data, ...).

Never include real API keys, customer data or personal data in a report.

## What to expect

This is a solo-maintained repository. Reports are acknowledged on a
best-effort basis, usually within a week. Confirmed issues are fixed on
`main`, noted in `CHANGELOG.md`, and credited if you wish.

## Security practices in this repository

- Secrets are read from environment variables only; `.env` is never committed.
- API keys are stored as SHA-256 hashes and shown once, at creation.
- Logs redact authorization headers, API keys and customer email addresses.
- `gitleaks` runs as a pre-commit hook and in CI on the full git history.
- Dependabot monitors npm packages and GitHub Actions; `pnpm audit` runs in CI.
- No test calls a paid LLM API; CI has no LLM credentials at all.
