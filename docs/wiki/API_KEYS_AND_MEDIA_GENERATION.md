# API Keys, Modality Toggles & Cross-Provider Media Generation

This guide explains where to configure API keys in **Zoo Code**, how dynamic modality toggles control which tools and prompt instructions the model sees, and how local or custom models (for example via LM Studio or Ollama) can invoke external **xAI**, **Google Gemini**, or **OpenRouter** media generation tools when the experimental fallback toggle is enabled.

---

## 1. Where to Configure API Keys

When `generate_image` or media generation runs, Zoo Code resolves API keys in the following **priority order**:

### Priority 1: Active Provider Profile or Experimental Image Generation Setting

1. **Provider Settings (`Settings → Providers`)**:
    - **xAI (Grok)**: Enter your **xAI API Key** (`xai-...`) in your xAI configuration profile.
    - **Google Gemini**: Enter your **Gemini API Key** (`AIza...`) in your Google Gemini configuration profile.
    - **OpenRouter**: Enter your **OpenRouter API Key** (`sk-or-...`) in your OpenRouter configuration profile.
2. **Experimental Image Generation Settings (`Settings → Experimental → Image Generation`)**:
    - Select your default **Image Generation Provider** (**OpenRouter**, **Google Gemini**, or **xAI (Grok Imagine)**) and default image model.
    - When **OpenRouter** is selected here, you can also provide a dedicated **OpenRouter Image API Key**.

### Priority 2: Saved Zoo Code Provider Profiles (Cross-Provider Lookup)

- If your **currently active** profile is a **Local** provider (for example, `LM Studio`, `Ollama`, or a local `OpenAI Compatible` server), its active profile does not carry an `xaiApiKey` or `geminiApiKey`.
- Zoo Code automatically searches your **other saved Provider Profiles** (stored via `ProviderSettingsManager` in VSCodium SecretStorage) and uses the first readable `xaiApiKey`, `geminiApiKey`, or `openRouterApiKey` you previously saved in your `xAI`, `Gemini`, or `OpenRouter` profile.

### Priority 3: Environment Variables (Shell / OS Fallback)

If no key is found in the active profile or saved profiles, Zoo Code falls back to standard environment variables inherited by VSCodium / VS Code:

| Provider          | Environment Variable(s)              | Example                                 |
| :---------------- | :----------------------------------- | :-------------------------------------- |
| **xAI (Grok)**    | `XAI_API_KEY`                        | `export XAI_API_KEY="xai-..."`          |
| **Google Gemini** | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `export GEMINI_API_KEY="AIza..."`       |
| **OpenRouter**    | `OPENROUTER_API_KEY`                 | `export OPENROUTER_API_KEY="sk-or-..."` |

---

## 2. Dynamic Modality Toggles & Clean User-Editable Modes

Zoo Code keeps mode definitions (`.roomodes` for Project Modes and `custom_modes.yaml` for Global Modes) clean and user-editable without hardcoding static media tool instructions into the mode persona.

Instead, **both the tool availability and the `CAPABILITIES` system-prompt instructions are dynamically gated on your Settings toggles**:

1. **Image Generation (`generate_image`)**:
    - **Toggled ON** (when the active provider’s **Allow Image Generation** checkbox is checked **OR** **Settings → Experimental → Image Generation** is checked):
        - The `generate_image` native tool is exposed to the model (in any mode with the `edit` group, such as `💻 Code` or `🎨 Media`).
        - The `CAPABILITIES` section of the system prompt dynamically includes the `generate_image` usage, workspace boundary, and artifact-preservation instructions.
    - **Toggled OFF** (when both the provider’s **Allow Image Generation** toggle and the **Experimental → Image Generation** toggle are off):
        - `generate_image` is removed from the tool list and its instructions are **completely omitted** from the system prompt so the model never sees inactive instructions.

2. **Video & Audio Generation**:
    - **Toggled ON** (when **Allow Video Generation** or **Allow Audio Generation** is checked in Provider Settings for a supported model):
        - The corresponding Video or Audio generation capability instruction is dynamically injected into `CAPABILITIES`.
    - **Toggled OFF**:
        - The instruction is completely hidden from the model’s system prompt.

---

## 3. Cross-Provider Fallback for Local & Custom Models

When using a local or custom model endpoint (via LM Studio, Ollama, or OpenAI-compatible servers) that does not natively report `supportsImageGeneration` in its catalog metadata:

1. Open **Settings → Experimental** and check **Enable Image Generation**.
2. Choose your preferred external image provider (**xAI (Grok Imagine)**, **Google Gemini**, or **OpenRouter**)—or leave it at default to let Zoo Code auto-select whichever provider has a readable API key configured in your saved profiles or environment variables.
3. Your local model will now receive the `generate_image` tool definition and capability instructions, and can generate or edit images using `grok-imagine-image-2.0`, `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, or OpenRouter image models seamlessly.
