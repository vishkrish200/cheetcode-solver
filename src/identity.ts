export const DEFAULT_GITHUB_IDENTITY = "trimaxeng2";

export function resolveGithubIdentity(value = process.env.CHEETCODE_GITHUB): string {
  const github = value?.trim() || DEFAULT_GITHUB_IDENTITY;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(github)) {
    throw new Error(`Invalid CHEETCODE_GITHUB identity: ${JSON.stringify(github)}`);
  }
  if (github === "trimax-eng") {
    throw new Error('CHEETCODE_GITHUB is still set to the legacy "trimax-eng" account; use the authenticated account "trimaxeng2".');
  }
  return github;
}
