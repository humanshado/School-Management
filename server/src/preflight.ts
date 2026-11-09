/**
 * Imported first by the entry points (before anything loads node:sqlite):
 * stops with a clear message on a Node version without the built-in SQLite module.
 * (Node prints a one-line "SQLite is an experimental feature" note on start: it is harmless.)
 */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nSchool Management needs Node.js 22.13 or newer (it uses Node's built-in SQLite).`);
  console.error(`This computer has Node.js ${process.versions.node}. Install the current LTS from https://nodejs.org and try again.\n`);
  process.exit(1);
}

