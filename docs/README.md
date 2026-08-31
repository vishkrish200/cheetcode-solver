# Documentation

[← Repository overview](../README.md)

This documentation has two jobs: make the engineering easy to explore, and make the limits of the evidence hard to miss. You can learn from the project without authenticating to the challenge or paying for a model call.

## Read the story

1. [The challenge](challenge.md): levels, timers, terminology, and version differences.
2. [V2 retrospective](findings/v2-retrospective.md): building a deterministic-first solving pipeline and reconstructing the score.
3. [V3 retrospective](findings/v3-retrospective.md): contract drift, trusted session context, and the final four-point recovery.
4. [Failure analysis](findings/failure-analysis.md): what failed, what changed, and what the code now checks.
5. [Evidence ledger](findings/evidence.md): which conclusions are public and reproducible, and which depend on private historical records.

## Run and inspect

- [Getting started](getting-started.md): the credential-free path, expected outcomes, and troubleshooting.
- [Architecture](architecture.md): component contracts, the three solver pipelines, and a source-code map.
- [Testing and evidence](testing.md): test layers, native execution, semantic coverage, and CI.
- [Candidate matrix](candidates.md): all eight Level 3 families, languages, provenance, and verification status.
- [V2 workspace](../solutions/v2/README.md) and [V3 workspace](../solutions/v3/README.md): version-local entry points.

## Reference and contribution

- [Command reference](commands.md): local, provider-assisted, public-network, and account-mutating commands.
- [Configuration](configuration.md): workspace paths, identity, storage, and optional provider adapters.
- [Toolchain and credits](toolchain.md): libraries, compilers, source retrieval, model assistance, and operational history.
- [Artifact policy](artifacts.md): reviewed source versus private run outputs; how to add safe findings.
- [Contributing](../CONTRIBUTING.md): version policy, checks, and review expectations.
- [Security](../SECURITY.md): credentials, untrusted code, and responsible reporting.

If a guide and a command disagree, treat it as a bug. Report the exact command, workspace, expected behavior, and a redacted error; do not attach raw run directories.
