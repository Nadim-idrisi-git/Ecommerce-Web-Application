// Browser audio plumbing for the realtime (Gemini Live) voice assistant:
// microphone -> 16kHz 16-bit PCM chunks, and 24kHz 16-bit PCM chunks ->
// gapless playback that can be cut off instantly on barge-in.

export const LIVE_INPUT_SAMPLE_RATE = 16000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;

// ~50ms per chunk: small enough that the server's voice activity detection
// reacts quickly to the end of the customer's sentence, large enough not to
// flood the socket with tiny frames.
const SAMPLES_PER_CHUNK = 800;

// Runs on the audio thread. The capture context runs at the device's native
// rate (Firefox refuses to connect a mic to a context at a different rate),
// so this downsamples to 16kHz itself with a box filter - plenty for speech.
const CAPTURE_WORKLET_SOURCE = `
class IdrisPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${LIVE_INPUT_SAMPLE_RATE};
    this.chunk = new Int16Array(${SAMPLES_PER_CHUNK});
    this.length = 0;
    this.sum = 0;
    this.count = 0;
    this.phase = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.sum += channel[i];
      this.count += 1;
      this.phase += 1;

      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.chunk[this.length] = value < 0 ? value * 0x8000 : value * 0x7fff;
        this.length += 1;

        if (this.length === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(${SAMPLES_PER_CHUNK});
          this.length = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("idris-pcm-capture", IdrisPcmCapture);
`;

const getAudioContextClass = () =>
  typeof window === "undefined" ? undefined : window.AudioContext || window.webkitAudioContext;

export const isLiveAudioSupported = () => {
  const AudioContextClass = getAudioContextClass();
  return Boolean(
    AudioContextClass &&
      typeof AudioWorkletNode !== "undefined" &&
      navigator.mediaDevices?.getUserMedia &&
      typeof WebSocket !== "undefined",
  );
};

// Must be called synchronously inside the click handler that opens the
// assistant - Safari only lets an AudioContext produce/consume audio when it
// was created (or resumed) during a user gesture.
export const createLiveAudioContexts = () => {
  const AudioContextClass = getAudioContextClass();
  const capture = new AudioContextClass();
  let playback;
  try {
    playback = new AudioContextClass({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
  } catch {
    // Older Safari rejects a custom sampleRate; buffers still play correctly
    // at 24kHz in a default-rate context (the browser resamples them).
    playback = new AudioContextClass();
  }
  capture.resume?.().catch(() => {});
  playback.resume?.().catch(() => {});
  return { capture, playback };
};

export const int16BufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Opens the microphone and streams base64 PCM chunks to onChunk until stop().
// echoCancellation matters most here: without it the assistant hears its own
// voice through the speakers and interrupts itself.
export const startMicCapture = async ({ audioContext, onChunk }) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const workletUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET_SOURCE], { type: "application/javascript" }),
  );

  let source;
  let node;
  let sink;
  try {
    await audioContext.audioWorklet.addModule(workletUrl);
    await audioContext.resume?.();

    source = audioContext.createMediaStreamSource(stream);
    node = new AudioWorkletNode(audioContext, "idris-pcm-capture");
    // Some engines only run a worklet that is pulled by the graph - route it
    // into a silent gain node so it always processes, without being audible.
    sink = audioContext.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(audioContext.destination);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  let muted = false;
  node.port.onmessage = (event) => {
    if (!muted) onChunk(int16BufferToBase64(event.data));
  };

  return {
    setMuted: (value) => {
      muted = Boolean(value);
    },
    stop: () => {
      node.port.onmessage = null;
      [source, node, sink].forEach((audioNode) => {
        try {
          audioNode.disconnect();
        } catch {
          // Already disconnected.
        }
      });
      stream.getTracks().forEach((track) => track.stop());
    },
  };
};

// Gapless scheduler for the model's streamed audio. flush() stops everything
// immediately (customer barge-in); onIdle fires once the last scheduled
// chunk has actually finished playing.
//
// Chromium's echo canceller only reliably treats media-element playback as
// its reference signal, so audio is routed through an <audio> element there
// (same fix the turn-based path uses in AIAssistant.speakText). Safari can
// report a successful play() on that route while producing no sound, so it
// stays on the direct AudioContext route.
export const createPcmPlayer = ({ audioContext, audioElement, preferElementRoute, onStart, onIdle }) => {
  let destination = audioContext.destination;
  let elementRoute = null;

  if (preferElementRoute && audioElement && typeof audioContext.createMediaStreamDestination === "function") {
    elementRoute = audioContext.createMediaStreamDestination();
    audioElement.srcObject = elementRoute.stream;
    destination = elementRoute;
    audioElement.play?.().catch(() => {
      // Autoplay refused the element route - fall back to the direct route
      // rather than going silent.
      audioElement.srcObject = null;
      destination = audioContext.destination;
      elementRoute = null;
    });
  }

  let sources = [];
  let nextStartTime = 0;
  let playing = false;

  const markIdleIfDone = () => {
    if (sources.length === 0 && playing) {
      playing = false;
      onIdle?.();
    }
  };

  return {
    enqueue: (base64) => {
      const bytes = base64ToBytes(base64);
      const sampleCount = Math.floor(bytes.length / 2);
      if (sampleCount <= 0) return;

      const audioBuffer = audioContext.createBuffer(1, sampleCount, LIVE_OUTPUT_SAMPLE_RATE);
      const channel = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
      for (let i = 0; i < sampleCount; i += 1) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
      }

      const node = audioContext.createBufferSource();
      node.buffer = audioBuffer;
      node.connect(destination);

      // A small lead on the very first chunk absorbs network jitter so the
      // second chunk doesn't arrive after the first has already finished.
      const startAt = Math.max(nextStartTime, audioContext.currentTime + (playing ? 0 : 0.05));
      node.start(startAt);
      nextStartTime = startAt + audioBuffer.duration;
      sources.push(node);

      node.onended = () => {
        sources = sources.filter((item) => item !== node);
        markIdleIfDone();
      };

      if (!playing) {
        playing = true;
        onStart?.();
      }
    },
    flush: () => {
      const stopping = sources;
      sources = [];
      nextStartTime = 0;
      stopping.forEach((node) => {
        node.onended = null;
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      });
      markIdleIfDone();
    },
    isPlaying: () => playing,
    close: () => {
      sources.forEach((node) => {
        node.onended = null;
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      });
      sources = [];
      if (elementRoute && audioElement) {
        audioElement.pause?.();
        audioElement.srcObject = null;
      }
    },
  };
};
