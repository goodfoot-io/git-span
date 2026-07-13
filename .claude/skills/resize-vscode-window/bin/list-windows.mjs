#!/usr/bin/env node
import { listWindows } from "./lib.mjs";
console.log(JSON.stringify(await listWindows(), null, 2));
