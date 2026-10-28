import type {
	TelemetryClient,
	TelemetryEvent,
	ClineMessage,
	AuthService,
	SettingsService,
	TelemetryPropertiesProvider,
} from "@roo-code/types"

/**
 * Cloud telemetry is permanently disabled in this fork.
 *
 * This client keeps the shape CloudService expects but contains no network code:
 * events, exceptions and task-message backfills are dropped, and no setting,
 * environment variable or default can turn sending back on.
 */
export class CloudTelemetryClient implements TelemetryClient {
	constructor(_authService: AuthService, _settingsService: SettingsService) {}

	public async capture(_event: TelemetryEvent): Promise<void> {}

	public async captureException(_error: Error, _additionalProperties?: Record<string, unknown>): Promise<void> {}

	public async backfillMessages(_messages: ClineMessage[], _taskId: string): Promise<void> {}

	public setProvider(_provider: TelemetryPropertiesProvider): void {}

	public updateTelemetryState(_didUserOptIn: boolean): void {}

	public isTelemetryEnabled(): boolean {
		return false
	}

	public async shutdown(): Promise<void> {}
}
