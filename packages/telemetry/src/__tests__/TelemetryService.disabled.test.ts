// npx vitest run src/__tests__/TelemetryService.disabled.test.ts

import { ZodError } from "zod"

import { type TelemetryClient, type TelemetryPropertiesProvider, TelemetryEventName } from "@roo-code/types"

import { TelemetryService } from "../TelemetryService"

const createSpyClient = () => {
	const client = {
		setProvider: vi.fn(),
		capture: vi.fn(async () => {}),
		captureException: vi.fn(async () => {}),
		updateTelemetryState: vi.fn(),
		isTelemetryEnabled: vi.fn(() => true),
		shutdown: vi.fn(async () => {}),
	} satisfies TelemetryClient

	return client
}

type SpyClient = ReturnType<typeof createSpyClient>

const expectUntouched = (client: SpyClient) => {
	expect(client.setProvider).not.toHaveBeenCalled()
	expect(client.capture).not.toHaveBeenCalled()
	expect(client.captureException).not.toHaveBeenCalled()
	expect(client.updateTelemetryState).not.toHaveBeenCalled()
	expect(client.shutdown).not.toHaveBeenCalled()
}

const exerciseEveryCapture = async (service: TelemetryService) => {
	const provider: TelemetryPropertiesProvider = {
		getTelemetryProperties: vi.fn(async () => ({}) as never),
	} as unknown as TelemetryPropertiesProvider // Only getTelemetryProperties is ever read by clients.

	service.setProvider(provider)
	service.updateTelemetryState(true)
	service.captureEvent(TelemetryEventName.TASK_CREATED, { taskId: "t" })
	service.captureException(new Error("crash"), { source: "test" })
	service.captureTaskCreated("t")
	service.captureTaskRestarted("t")
	service.captureConversationMessage("t", "user")
	service.captureModeSwitch("t", "code")
	service.captureToolUsage("t", "read_file")
	service.captureCheckpointCreated("t")
	service.captureCheckpointDiffed("t")
	service.captureCheckpointRestored("t")
	service.captureContextCondensed("t", true, false)
	service.captureSlidingWindowTruncation("t")
	service.captureCodeActionUsed("explain")
	service.capturePromptEnhanced("t")
	service.captureSchemaValidationError({ schemaName: "s", error: new ZodError([]) })
	service.captureDiffApplicationError("t", 3)
	service.captureShellIntegrationError("t")
	service.captureTabShown("settings")
	service.captureModeSettingChanged("roleDefinition")
	service.captureCustomModeCreated("slug", "name")
	service.captureMarketplaceItemRemoved("id", "mode", "name", "global")
	service.captureTitleButtonClicked("history")
	service.captureTelemetrySettingsChanged("unset", "enabled")
	await service.shutdown()

	expect(provider.getTelemetryProperties).not.toHaveBeenCalled()
}

describe("TelemetryService (permanently disabled)", () => {
	beforeEach(() => {
		TelemetryService["_instance"] = null
	})

	afterEach(() => {
		TelemetryService["_instance"] = null
	})

	it("drops clients passed to the constructor", async () => {
		const client = createSpyClient()
		const service = new TelemetryService([client])

		await exerciseEveryCapture(service)

		expectUntouched(client)
		expect(service.isTelemetryEnabled()).toBe(false)
	})

	it("drops clients passed to register()", async () => {
		const client = createSpyClient()
		const service = new TelemetryService()
		service.register(client)

		await exerciseEveryCapture(service)

		expectUntouched(client)
		expect(service.isTelemetryEnabled()).toBe(false)
	})

	it("drops clients passed to createInstance()", async () => {
		const client = createSpyClient()
		const service = TelemetryService.createInstance([client])

		await exerciseEveryCapture(service)

		expectUntouched(client)
		expect(TelemetryService.instance.isTelemetryEnabled()).toBe(false)
	})

	it("reports telemetry as disabled even after the user opts in", () => {
		const service = TelemetryService.createInstance()

		service.updateTelemetryState(true)

		expect(service.isTelemetryEnabled()).toBe(false)
	})
})
