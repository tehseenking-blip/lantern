# Colibri local inference in Lantern

Colibri is an additional local provider, not a replacement for LM Studio or Ollama. Existing conversations, models, settings, memories and stored credentials are preserved. This integration calls the **JustVugg/colibri** OpenAI-compatible HTTP server; it does not bundle or silently install its engine, copy its source, download weights, or convert your existing models.

## Windows setup

1. Install/build Colibri separately following its upstream instructions: https://github.com/JustVugg/colibri . Use a model and format supported by your Colibri release. A model working in LM Studio does **not** prove it works in Colibri.
2. From the Colibri checkout, start a prepared model:

```powershell
py -3 c\coli serve --model "D:\Models\your-colibri-model" --host 127.0.0.1 --port 8000
```

Or use Lantern's path-safe launcher (existing installations only):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-colibri.ps1 -CheckoutPath "D:\Colibri" -ModelPath "D:\Models\your-colibri-model"
```

The execution-policy override applies only to this invocation; the script does not change the system policy. Keep the server terminal open. The script never downloads models or runs package installers. Its `-PrintCommand` option validates paths and prints configuration without starting an engine.

3. Open **Lantern > Settings > Providers > Colibri**. Default address: `http://127.0.0.1:8000/v1`. Save changes before connecting.
4. When Colibri uses `COLI_API_KEY`, save the same key in Lantern's Colibri card. Keys stay in the main process and are used for discovery and generation. No key is hard-coded.
5. Click **Test connection**, then **Test model response**. The latter sends only a fixed harmless sentence, never your history, documents or memories. It has a three-minute deadline.
6. Click **Use Colibri for new chats**, create a conversation, open its model settings, and select the exact returned model ID. Existing chats keep their provider; change those individually.

## Boundaries and compatibility

- Only loopback HTTP(S) URLs are allowed. LAN/public URLs, embedded credentials, query strings and redirects are rejected. There is no online fallback. This intentionally does not enable remote-PC access.
- Requests use `/v1/models` and streamed `/v1/chat/completions`, with `max_tokens`, `temperature`, `top_p` and usage reporting. Colibri context capacity is configured in its server; Lantern's context setting only budgets the prompt.
- Handles UTF-8 chunks, SSE comments/CRLF/multiline frames, completion markers, usage-only frames, Stop, timeouts, authentication failures and disconnected streams. Hidden reasoning is not shown as the answer. Reasoning-only replies produce an actionable message rather than silent success.
- Large models reading weights from SSD may be slow. Normal chat times out after five minutes without stream activity. No throughput, VRAM-fit or model-quality guarantee has been established for your GPU.
- Model architecture support is determined by the installed Colibri version. Keep LM Studio for models that Colibri does not support. This change does not make Qwen/Gemma versions universally compatible.
- No existing model files, clinical app repositories, or external services are modified. The upstream engine has its own licence and operational requirements.

## Troubleshooting

**Connection refused:** start the local server and check port/address. **401/403:** align the locally saved key with `COLI_API_KEY`. **No models:** wait for a prepared model to load; inspect the server terminal. **Not found/404:** use the server API port, not its web UI. **No answer/reasoning only:** increase the reply budget or disable thinking in the server. **Timeout/OOM:** inspect local engine logs and use a compatible smaller model/offload configuration. Never paste private chat contents or keys into issue reports.

## Optional real-model check

With Colibri already running, in the Lantern source folder:

```powershell
# Optional: use the exact ID returned by /v1/models.
$env:COLIBRI_MODEL = "your-exact-model-id"
npm run test:colibri
```

`COLIBRI_BASE_URL` overrides the default local address; `COLI_API_KEY` supplies an optional key. The check reports first-token latency and complete duration for a fixed prompt. It does not load your database. Model testing uses the GPU/CPU configured by Colibri, not by Lantern.
