import type { LaunchPhase } from "./data/types";

/** Human label for a launch phase. */
export function phaseLabel(phase: LaunchPhase): string {
  switch (phase) {
    case "presale":
      return "Presale";
    case "graduating":
      return "Graduating";
    case "graduated":
      return "Graduated";
  }
}
