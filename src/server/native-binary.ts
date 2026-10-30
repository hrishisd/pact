// Development and test guard: better-sqlite3's binary is built for one Node ABI, and a rebuild
// under another Node leaves the right Node running with the wrong binary. Only loading it tells.

import Database from "better-sqlite3";

/** Importing better-sqlite3 doesn't load the binary; opening a database does. */
export function exitUnlessNativeBinaryLoads(): void {
  try {
    new Database(":memory:").close();
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("NODE_MODULE_VERSION"))) throw error;
    console.error(
      `better-sqlite3's binary wasn't built for Node ${process.versions.node}. Run under the pinned Node (fnm use), and rebuild: fnm exec --using=.nvmrc npm rebuild better-sqlite3`,
    );
    process.exit(1);
  }
}
