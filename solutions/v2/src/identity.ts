export function resolveGithubIdentity(value = process.env.CHEETCODE_GITHUB): string {
  const github = value?.trim();
  if (!github) {
    throw new Error("Set CHEETCODE_GITHUB to the GitHub handle for the authenticated CheetCode session.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(github)) {
    throw new Error(`Invalid CHEETCODE_GITHUB identity: ${JSON.stringify(github)}`);
  }
  return github;
}
