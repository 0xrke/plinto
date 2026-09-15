import { DATA_SOURCE } from "../config";
import { StubLaunchActions } from "./actions";
import { MockDataSource } from "./mock";
import type { LaunchActions, LaunchDataSource } from "./types";

export * from "./types";
export { MockDataSource } from "./mock";
export { StubLaunchActions } from "./actions";

/** Creates the configured data source. The chain source is not implemented yet (M4). */
export function createDataSource(): LaunchDataSource {
  switch (DATA_SOURCE) {
    case "chain":
    case "mock":
    default:
      return new MockDataSource();
  }
}

export function createActions(): LaunchActions {
  return new StubLaunchActions();
}
