# Security Policy

Pie is pre-release software and has not had a formal external security audit.

## Reporting Security Issues

Please do not file public issues containing credentials, local profile state, private logs, or exploit details.

If you find a security issue, report it privately to the repository maintainer. Include:

1. A concise description of the issue.
2. Steps to reproduce without real credentials.
3. The affected channel, backend, or desktop surface.
4. Whether local files, shell commands, network access, or provider credentials are involved.

## Local Secrets

Pie stores profile-scoped secrets in:

```text
~/.pie/profiles/<profile-id>/.env
```

Do not commit `.env` files, local profile directories, provider keys, channel tokens, or generated runtime state.

## Runtime Access

Pie is not a security sandbox. The Runtime Environment currently sets `homeDir`, `workDir`, and lifecycle state only. File, command, and network access depend on the selected backend and underlying tools.

Do not expose local gateway ports to the public internet without explicit authentication, authorization, and deployment hardening.

## Known Dependency Notes

`npm audit --omit=dev` may report moderate advisories through `@larksuiteoapi/node-sdk` and its transitive `axios` dependency. Treat channel credential handling and network egress carefully until the upstream SDK path is updated.
