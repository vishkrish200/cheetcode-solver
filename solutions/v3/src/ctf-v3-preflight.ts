import { TARGET_URL } from "./recon/capture.js";

export interface CtfV3Contract {
  title: string;
  description: string;
  constants: {
    problemsPerSession: number;
    level2Total: number;
    level3Total: number;
    level2DurationSeconds: number;
    level3DurationSeconds: number;
    totalDurationSeconds: number;
  };
  routes: string[];
}

export const EXPECTED_V3_CONTRACT = {
  title: "CheetCode v3",
  description: "3 levels. 60 problems. 240 seconds. Good luck.",
  constants: {
    problemsPerSession: 25,
    level2Total: 10,
    level3Total: 25,
    level2DurationSeconds: 60,
    level3DurationSeconds: 120,
    totalDurationSeconds: 240
  },
  routes: [
    "/api/session",
    "/api/session/restore",
    "/api/session/replay",
    "/api/level-1/validate",
    "/api/level-1/finish",
    "/api/level-2/preview",
    "/api/level-3/preview"
  ]
} as const;

export async function fetchPublicContract(baseUrl = TARGET_URL): Promise<CtfV3Contract> {
  const pageUrl = new URL(baseUrl);
  const html = await fetchText(pageUrl);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((src): src is string => Boolean(src));
  const bundles = await Promise.all(scripts.map((src) => fetchText(new URL(src, pageUrl))));
  return parsePublicContract(html, bundles.join("\n"));
}

export function assertExpectedV3Contract(contract: CtfV3Contract): void {
  if (contract.title !== EXPECTED_V3_CONTRACT.title) {
    throw new Error(`Unexpected title: ${contract.title}`);
  }
  if (contract.description !== EXPECTED_V3_CONTRACT.description) {
    throw new Error(`Unexpected challenge description: ${contract.description}`);
  }

  for (const [key, expected] of Object.entries(EXPECTED_V3_CONTRACT.constants)) {
    const actual = contract.constants[key as keyof typeof contract.constants];
    if (actual !== expected) throw new Error(`Unexpected ${key}: ${actual}; expected ${expected}`);
  }

  for (const route of EXPECTED_V3_CONTRACT.routes) {
    if (!contract.routes.includes(route)) throw new Error(`Missing route in deployed bundle: ${route}`);
  }
}

export function parsePublicContract(html: string, bundleText: string): CtfV3Contract {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1]?.trim() ?? "";
  const readConstant = (name: string): number => {
    const match = bundleText.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    if (!match) throw new Error(`Missing deployed constant: ${name}`);
    return Number(match[1]);
  };

  const routes = [...bundleText.matchAll(/\/api\/[a-z0-9/_-]+/g)].map((match) => match[0]);
  return {
    title,
    description,
    constants: {
      problemsPerSession: readConstant("PROBLEMS_PER_SESSION"),
      level2Total: readConstant("LEVEL2_TOTAL"),
      level3Total: readConstant("LEVEL3_TOTAL"),
      level2DurationSeconds: readConstant("LEVEL2_DURATION_SECONDS"),
      level3DurationSeconds: readConstant("LEVEL3_DURATION_SECONDS"),
      totalDurationSeconds: readConstant("TOTAL_DURATION_SECONDS")
    },
    routes: [...new Set(routes)]
  };
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} failed with ${response.status}`);
  return response.text();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchPublicContract()
    .then((contract) => {
      assertExpectedV3Contract(contract);
      console.log(JSON.stringify({ url: TARGET_URL, contract }, null, 2));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Missing deployed constant:")) {
        console.error(
          `Preflight blocked: ${message}. The unauthenticated page shell does not expose the authenticated game bundle; use the isolated Comet profile for the next capture.`
        );
      } else {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
      }
      process.exitCode = 1;
    });
}
