import type { LaunchMath } from "@/lib/landing/sim/launch";

/** Props every variant's default export receives. `m` is computed on the server (fromSdk + launchMath). */
export interface VariantProps {
  m: LaunchMath;
}
