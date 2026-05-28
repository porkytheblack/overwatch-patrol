'use client';
/**
 * Push-to-talk voice panel.
 *
 * Self-contained mic → STT → `/api/agent/message` → TTS loop. We use
 * the low-level `glove-voice` adapters (not the `GloveVoice` orchestrator
 * or `glove-react` hooks) because the agent intelligence lives on our
 * server, not in the browser — `GloveVoice` expects a local Glove
 * instance, which we deliberately don't ship to the dashboard.
 *
 * The panel owns its own round-trip because:
 *  1. STT 'final' fires from inside the EventEmitter, well after the
 *     parent rendered. Bridging through React state to `ConversationPanel.
 *     onSend` would add at least one tick of latency on every utterance.
 *  2. TTS playback wants the reply text *immediately* — opening the TTS
 *     socket in parallel with the LLM call hides the ~200ms handshake.
 *
 * The parent stays in sync because we fire `onTranscript(userText)` and
 * `onAgentReply(replyText)` callbacks so its `messages` array picks up
 * both bubbles.
 *
 * NEXT_PUBLIC_VOICE_ENABLED is checked at the call site (in
 * `ConversationPanel`) — this component is only mounted when voice is
 * on, so we don't re-check it here.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  AudioCapture as AudioCaptureType,
  AudioPlayer as AudioPlayerType,
  STTAdapter,
  TTSAdapter,
  TTSFactory,
} from 'glove-voice';

type Mode =
  | 'init'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'disabled';

interface Props {
  /**
   * Called with the user's finalized utterance text so the parent can
   * append a user bubble to the chat log. The actual round-trip to the
   * agent happens inside this component (see file-level comment).
   */
  onTranscript: (text: string) => void;
  /** Called with the agent's reply text so the parent can append the agent bubble. */
  onAgentReply: (text: string) => void;
  /** Errors from mic init, STT, agent fetch, or TTS. */
  onError: (err: Error) => void;
}

export function VoicePanel({ onTranscript, onAgentReply, onError }: Props) {
  const [mode, setMode] = useState<Mode>('init');
  const [unavailableReason, setUnavailableReason] = useState<string | null>(
    null,
  );
  const captureRef = useRef<AudioCaptureType | null>(null);
  const playerRef = useRef<AudioPlayerType | null>(null);
  const sttRef = useRef<STTAdapter | null>(null);
  const createTTSRef = useRef<TTSFactory | null>(null);
  /** True while the operator is holding the PTT button down. */
  const heldRef = useRef(false);
  /** Latest callbacks, kept in refs so the long-lived STT 'final'
   *  handler can call current closures without us tearing the whole
   *  pipeline down whenever the parent re-renders. */
  const onTranscriptRef = useRef(onTranscript);
  const onAgentReplyRef = useRef(onAgentReply);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onAgentReplyRef.current = onAgentReply;
    onErrorRef.current = onError;
  }, [onTranscript, onAgentReply, onError]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Probe `/api/voice/tts-token` first. The endpoint 503s when
        // `ELEVENLABS_API_KEY` is unset on the server, and we want to
        // surface that to the operator before we ask for the mic
        // permission. The voice id also has to come from the server
        // because it's read from `ENV.ELEVENLABS_VOICE_ID`.
        const probe = await fetch('/api/voice/tts-token', {
          credentials: 'include',
        });
        if (!probe.ok) {
          const body = (await probe.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `voice unavailable (HTTP ${probe.status})`);
        }
        const probeBody = (await probe.json()) as {
          token: string;
          voice_id: string;
        };
        const voiceId = probeBody.voice_id;

        // Dynamic import keeps `glove-voice` out of the initial JS
        // bundle and out of the SSR pass — it touches Web Audio APIs
        // that don't exist in Node.
        const { createElevenLabsAdapters, AudioCapture, AudioPlayer } =
          await import('glove-voice');

        const { stt, createTTS } = createElevenLabsAdapters({
          getSTTToken: () =>
            fetch('/api/voice/stt-token', { credentials: 'include' })
              .then(async (r) => {
                if (!r.ok) {
                  const b = (await r.json().catch(() => ({}))) as {
                    error?: string;
                  };
                  throw new Error(b.error ?? `stt-token ${r.status}`);
                }
                return r.json();
              })
              .then((d: { token: string }) => d.token),
          getTTSToken: () =>
            fetch('/api/voice/tts-token', { credentials: 'include' })
              .then(async (r) => {
                if (!r.ok) {
                  const b = (await r.json().catch(() => ({}))) as {
                    error?: string;
                  };
                  throw new Error(b.error ?? `tts-token ${r.status}`);
                }
                return r.json();
              })
              .then((d: { token: string }) => d.token),
          voiceId,
        });

        const capture = new AudioCapture(16000);
        const player = new AudioPlayer(16000);
        // init() asks for the mic — if the user denies, this rejects
        // and we surface it as `disabled`.
        await capture.init();
        await player.init();
        await stt.connect();

        capture.on('chunk', (pcm: Int16Array) => {
          if (heldRef.current && stt.isConnected) stt.sendAudio(pcm);
        });

        stt.on('partial', () => {
          // Partial transcripts could surface as a "live caption" later;
          // for v1 we keep the UI quiet and only commit on `final`.
        });

        stt.on('final', (text: string) => {
          handleFinalUtterance(text, stt, player, createTTS).catch((e) => {
            onErrorRef.current(e as Error);
            setMode('idle');
          });
        });

        stt.on('error', (e: Error) => {
          onErrorRef.current(e);
        });

        stt.on('close', () => {
          // The STT socket can drop on long idles — surface and disable
          // until the operator reloads. Auto-reconnect is owned by the
          // ElevenLabs adapter itself; only escalate if it gave up.
          if (cancelled) return;
          setMode('disabled');
          setUnavailableReason('stt disconnected');
        });

        if (cancelled) {
          await capture.destroy().catch(() => undefined);
          await player.destroy().catch(() => undefined);
          stt.disconnect();
          return;
        }

        captureRef.current = capture;
        playerRef.current = player;
        sttRef.current = stt;
        createTTSRef.current = createTTS;
        setMode('idle');
      } catch (e) {
        if (cancelled) return;
        setMode('disabled');
        setUnavailableReason(String((e as Error).message ?? e));
        onErrorRef.current(e as Error);
      }
    })();

    return () => {
      cancelled = true;
      // Teardown order: stop mic → close STT → stop playback. Each
      // method is idempotent and `.catch(() => undefined)` swallows the
      // double-destroy noise StrictMode produces in dev.
      captureRef.current?.destroy().catch(() => undefined);
      playerRef.current?.destroy().catch(() => undefined);
      sttRef.current?.disconnect();
      captureRef.current = null;
      playerRef.current = null;
      sttRef.current = null;
      createTTSRef.current = null;
    };
  }, []);

  /**
   * Round-trips a finalized transcript through the agent and plays the
   * reply via TTS. Opens the TTS socket *before* fetching the reply so
   * the handshake overlaps with the LLM round-trip.
   */
  async function handleFinalUtterance(
    text: string,
    _stt: STTAdapter,
    player: AudioPlayerType,
    createTTS: TTSFactory,
  ): Promise<void> {
    const cleaned = text.trim();
    if (!cleaned) {
      setMode('idle');
      return;
    }
    onTranscriptRef.current(cleaned);
    setMode('thinking');

    let tts: TTSAdapter | null = null;
    try {
      // Open TTS in parallel with the agent call to hide the WS handshake.
      tts = createTTS();
      const ttsOpen = tts.open();

      tts.on('audio_chunk', (pcm: Uint8Array) => {
        player.enqueue(pcm);
      });
      tts.on('done', () => {
        setMode('idle');
      });
      tts.on('error', (e: Error) => {
        onErrorRef.current(e);
        setMode('idle');
      });

      const r = await fetch('/api/agent/message', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: cleaned }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `agent HTTP ${r.status}`);
      }
      const reply = (await r.json()) as {
        text: string;
        meta?: { pending_confirmation?: unknown };
      };
      onAgentReplyRef.current(reply.text);

      // Wait for the TTS socket to be ready before sending text so the
      // adapter doesn't drop chunks. (ElevenLabs adapter queues
      // internally, but the wait is cheap and avoids any future
      // semantics changes biting us.)
      await ttsOpen;
      setMode('speaking');
      tts.sendText(reply.text);
      tts.flush();
    } catch (e) {
      // Best-effort teardown: if the agent call blew up before TTS got
      // any text, drop the socket so we don't leak a half-open WS.
      try {
        tts?.destroy();
      } catch {
        /* swallow */
      }
      throw e;
    }
  }

  const enabled = mode === 'idle' || mode === 'listening';

  function onDown(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!enabled || mode === 'listening') return;
    heldRef.current = true;
    setMode('listening');
  }

  function onUp(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!heldRef.current) return;
    heldRef.current = false;
    // Tell STT to finalize what it has buffered. The 'final' handler
    // will pick up the transcript, fire `onTranscript`, then drive the
    // agent + TTS round-trip.
    sttRef.current?.flushUtterance();
    setMode('thinking');
  }

  const label =
    mode === 'listening'
      ? 'RELEASE TO SEND'
      : mode === 'thinking'
        ? 'THINKING…'
        : mode === 'speaking'
          ? 'SPEAKING…'
          : mode === 'disabled'
            ? 'UNAVAILABLE'
            : mode === 'init'
              ? 'STARTING…'
              : 'HOLD TO TALK';

  return (
    <div className="card mt-2 flex flex-col items-stretch gap-2">
      <div className="flex items-baseline justify-between">
        <span className="mono uppercase text-[10px] text-text-dim tracking-[0.04em]">
          voice · push-to-talk
        </span>
        <span className="mono text-[10px] text-text-dim uppercase">
          {mode}
        </span>
      </div>
      <button
        type="button"
        className={`btn ${mode === 'listening' ? 'btn-primary' : ''} h-12 mono text-sm`}
        disabled={!enabled}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchEnd={onUp}
        onTouchCancel={onUp}
        aria-pressed={mode === 'listening'}
      >
        {label}
      </button>
      {mode === 'disabled' && unavailableReason && (
        <div className="mono text-[10px] text-text-dim leading-snug">
          voice unavailable · {unavailableReason}. configure ELEVENLABS_API_KEY
          on ov-api and reload.
        </div>
      )}
      {mode !== 'disabled' && (
        <div className="mono text-[10px] text-text-dim leading-snug">
          hold the button while you speak. release to send. the agent answers
          in voice and the bubbles also land in the chat above.
        </div>
      )}
    </div>
  );
}
