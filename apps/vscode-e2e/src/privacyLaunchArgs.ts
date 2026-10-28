/**
 * Arguments added to every VS Code instance the e2e harness launches.
 *
 * The harness downloads a stock Microsoft VS Code build, which enables usage
 * telemetry and crash reporting by default. These flags keep test runs from
 * sending either.
 */
export const PRIVACY_LAUNCH_ARGS: readonly string[] = ["--disable-telemetry", "--disable-crash-reporter"]
