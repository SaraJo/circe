// Copies the repository's user-facing Markdown into website/docs so the
// site and the GitHub-rendered files share one source of truth.
// Relative links are rewritten: synced pages link to each other inside the
// site, everything else points at the file on GitHub.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(websiteDir, '..');
const docsDir = path.join(websiteDir, 'docs');
const imgDir = path.join(websiteDir, 'static', 'img', 'synced');
const githubBlob = 'https://github.com/SaraJo/circe/blob/main/';

// Repo-relative source -> generated doc file and sidebar position.
const pages = [
  { src: 'INSTALL.md', out: 'install.md', position: 2 },
  { src: 'docs/ONBOARDING.md', out: 'onboarding.md', position: 3 },
  { src: 'docs/WINDOWS.md', out: 'windows.md', position: 4 },
  { src: 'docs/BETA_TEST.md', out: 'beta-test.md', position: 5 },
  { src: 'CHANGELOG.md', out: 'release-notes.md', position: 6 },
  { src: 'CONTRIBUTING.md', out: 'contributing.md', position: 7 },
];
const routes = new Map(pages.map((p) => [p.src, p.out]));
routes.set('README.md', 'intro.mdx');

function rewriteLink(target, srcFile) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [file, hash = ''] = target.split(/(?=#)/);
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(srcFile), file));
  if (routes.has(repoPath)) return `./${routes.get(repoPath)}${hash}`;
  if (repoPath.startsWith('docs/images/')) return `/img/synced/${path.posix.basename(repoPath)}`;
  return githubBlob + repoPath + hash;
}

function transform(markdown, srcFile, position) {
  const body = markdown
    // GitHub-only navigation; the site has its own sidebar.
    .replace(/^\[← Back to the README\]\([^)]*\)\n\n?/m, '')
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_, open, target, close) =>
      open + rewriteLink(target, srcFile) + close,
    );
  const editUrl = githubBlob.replace('/blob/', '/edit/') + srcFile;
  return `---\nsidebar_position: ${position}\ncustom_edit_url: ${editUrl}\n---\n\n${body}`;
}

await mkdir(docsDir, { recursive: true });
for (const entry of await readdir(docsDir)) {
  if (entry !== 'intro.mdx') await rm(path.join(docsDir, entry), { recursive: true });
}
for (const page of pages) {
  const source = await readFile(path.join(repoDir, page.src), 'utf8');
  await writeFile(path.join(docsDir, page.out), transform(source, page.src, page.position));
}

await rm(imgDir, { recursive: true, force: true });
await mkdir(imgDir, { recursive: true });
const imageSources = [
  ...(await readdir(path.join(repoDir, 'docs/images'))).map((f) => `docs/images/${f}`),
  'docs/media/circe-demo.mp4',
  'resources/icon-v4.png',
];
for (const src of imageSources) {
  await copyFile(path.join(repoDir, src), path.join(imgDir, path.basename(src)));
}

console.log(`Synced ${pages.length} docs and ${imageSources.length} images into website/`);
