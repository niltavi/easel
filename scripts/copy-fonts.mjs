// Excalidraw fetches fonts from a CDN by default; once copied into public/ they are served by this site and work offline too.
import {cpSync, existsSync, rmSync} from "node:fs";

const from = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const to = "public/fonts";
if (existsSync(from)) {
  rmSync(to, {recursive: true, force: true});
  cpSync(from, to, {recursive: true});
}
