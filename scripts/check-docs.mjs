import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED = new Set([".git", "node_modules", "recon-output", "output", "level1-output", ".codex", ".agents"]);

export function markdownFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || IGNORED.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...markdownFiles(fullPath));
    else if (entry.name.endsWith(".md")) result.push(fullPath);
  }
  return result;
}

function withoutFences(text) {
  return text.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1\s*$/gm, "");
}

export function headingAnchors(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const match of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  }
  return anchors;
}

export function checkDocs(root = ROOT) {
  const files = markdownFiles(root);
  const errors = [];
  let links = 0;
  for (const file of files) {
    const text = withoutFences(readFileSync(file, "utf8"));
    for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1].replace(/^<|>$/g, "");
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
      links += 1;
      const [rawTarget, rawAnchor] = href.split("#", 2);
      let target;
      let anchor;
      try {
        target = rawTarget ? path.resolve(path.dirname(file), decodeURIComponent(rawTarget)) : file;
        anchor = rawAnchor ? decodeURIComponent(rawAnchor) : undefined;
      } catch {
        errors.push(`${path.relative(root, file)}: invalid URL encoding in ${href}`);
        continue;
      }
      const relative = path.relative(root, target);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
        errors.push(`${path.relative(root, file)}: link escapes repository: ${href}`);
      } else if (!existsSync(target)) {
        errors.push(`${path.relative(root, file)}: missing target ${href}`);
      } else if (anchor && target.endsWith(".md") && statSync(target).isFile() && !headingAnchors(readFileSync(target, "utf8")).has(anchor)) {
        errors.push(`${path.relative(root, file)}: missing heading ${href}`);
      }
    }
  }
  return { files: files.length, links, errors };
}

export function main() {
  const result = checkDocs();
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Documentation OK: ${result.files} Markdown files, ${result.links} local links. External URLs are not fetched.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
