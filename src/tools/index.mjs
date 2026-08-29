/**
 * Tool registry. Import all tools, expose them as a map.
 */

import * as shell from "./shell.mjs";
import * as fileRead from "./file-read.mjs";
import * as fileWrite from "./file-write.mjs";

export const tools = new Map([
  [shell.name, shell],
  [fileRead.name, fileRead],
  [fileWrite.name, fileWrite],
]);
