import { exitUnlessNativeBinaryLoads } from "./native-binary.ts";

export function setup(): void {
  try {
    exitUnlessNativeBinaryLoads();
  } catch (error) {
    // Thrown from here, Vitest's own error printer crashes (code.charCodeAt) and hides the error.
    console.error(error);
    process.exit(1);
  }
}
