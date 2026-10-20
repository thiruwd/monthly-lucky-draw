import { cp, mkdir } from 'node:fs/promises';

// Vercel serves public assets through its CDN instead of express.static().
for (const [name, source] of [
  ['bootstrap', 'bootstrap/dist'],
  ['sweetalert2', 'sweetalert2/dist'],
  ['confetti', 'canvas-confetti/dist']
]) {
  const destination = new URL(`../public/vendor/${name}/`, import.meta.url);
  await mkdir(destination, { recursive: true });
  await cp(new URL(`../node_modules/${source}/`, import.meta.url), destination, { recursive: true });
}
console.log('Vercel browser assets are ready.');
