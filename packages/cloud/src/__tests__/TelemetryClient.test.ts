// npx vitest run src/__tests__/TelemetryClient.test.ts

import {
	type AuthService,
	type ClineMessage,
	type SettingsService,
	type TelemetryPropertiesProvider,
	TelemetryEventName,
} from "@roo-code/types"

import { CloudTelemetryClient } from "../TelemetryClient.js"

describe("CloudTelemetryClient", () => {
	const mockFetch = vi.fn<typeof fetch>()

	// Partial doubles: the client must ignore these entirely, so only the members an
	// authenticated, task-sync-enabled session would expose are provided.
	const authService = {
		isAuthenticated: vi.fn(() => true),
		getSessionToken: vi.fn(() => "mock-token"),
	} as unknown as AuthService
	const settingsService = { isTaskSyncEnabled: vi.fn(() => true) } as unknown as SettingsService

	const createClient = () => new CloudTelemetryClient(authService, settingsService)

	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubGlobal("fetch", mockFetch)
		vi.stubEnv("ROO_CODE_DISABLE_TELEMETRY", "")
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
	})

	it("reports telemetry as disabled even when authenticated and the env opt-out is unset", () => {
		const client = createClient()

		client.updateTelemetryState(true)

		expect(client.isTelemetryEnabled()).toBe(false)
	})

	it("never sends captured events", async () => {
		const client = createClient()
		const provider: TelemetryPropertiesProvider = {
			getTelemetryProperties: vi.fn(),
		} as unknown as TelemetryPropertiesProvider // Only getTelemetryProperties is observed.
		client.setProvider(provider)
		client.updateTelemetryState(true)

		await client.capture({ event: TelemetryEventName.TASK_CREATED, properties: { taskId: "task-1" } })
		await client.capture({ event: TelemetryEventName.TASK_MESSAGE, properties: { taskId: "task-1" } })

		expect(mockFetch).not.toHaveBeenCalled()
		expect(provider.getTelemetryProperties).not.toHaveBeenCalled()
	})

	it("never sends exceptions", async () => {
		const client = createClient()

		await client.captureException(new Error("boom"), { source: "test" })

		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("never uploads task messages via backfill", async () => {
		const client = createClient()
		const messages: ClineMessage[] = [{ ts: 1, type: "say", say: "text", text: "secret task content" }]

		await client.backfillMessages(messages, "task-1")

		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("shuts down without network activity", async () => {
		await createClient().shutdown()

		expect(mockFetch).not.toHaveBeenCalled()
	})
})
