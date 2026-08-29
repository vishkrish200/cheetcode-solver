const SENSITIVE_HEADER_PATTERNS = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^proxy-authorization$/i,
  /^x-api-key$/i,
  /^api-key$/i,
  /token/i,
  /secret/i,
  /session/i,
  /csrf/i
];

const REDACTED = "[REDACTED]";

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(name)) ? REDACTED : value
    ])
  );
}

export function redactText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, REDACTED)
    .replace(/("?(?:access_token|refresh_token|id_token|token|secret|password)"?\s*[:=]\s*)"[^"]+"/gi, `$1"${REDACTED}"`)
    .replace(/((?:access_token|refresh_token|id_token|token|secret|password)=)[^&\s]+/gi, `$1${REDACTED}`);
}
