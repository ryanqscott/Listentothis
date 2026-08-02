# Audio Passthrough

Send whatever you're listening to (a video, a song, a stream) into your microphone
input, so people on a Discord or WhatsApp call can hear it along with your voice.

It works by using `ffmpeg` to capture your system's audio output (via a loopback /
"Stereo Mix" recording device), optionally mixing in your real microphone, and
streaming the combined, raw PCM audio to [naudiodon2](https://www.npmjs.com/package/naudiodon2)
(a PortAudio binding), which plays it out to a specific playback device — a virtual
audio cable's "Input" device. Discord/WhatsApp then use that cable's "Output"
device as their "microphone".

(Note: `ffmpeg` itself has no built-in way to play audio live to a chosen Windows
device — its `dshow` input can capture, but there's no matching output/playback
device muxer. That's why `naudiodon2` handles the final output step.)

## Prerequisites

1. **Node.js** 18+.
2. **ffmpeg** installed and available on your `PATH` (`ffmpeg -version` should work
   in a terminal). After adding it to PATH, restart VS Code / your terminal — an
   already-running shell won't pick up a PATH change made after it launched.
3. A **virtual audio cable** driver, e.g. [VB-Audio Virtual Cable](https://vb-audio.com/Cable/).
   This creates two devices:
   - `CABLE Input (VB-Audio Virtual Cable)` — a playback device (this app writes to it).
   - `CABLE Output (VB-Audio Virtual Cable)` — a recording device (Discord/WhatsApp read from it).
4. A way to capture "what you hear":
   - Windows: enable **Stereo Mix** under Sound Settings → Recording devices (right
     click in the Recording tab → Show Disabled Devices, if it's hidden). Some sound
     cards don't expose Stereo Mix — in that case use your virtual cable's own
     loopback/monitor recording device instead.
   - **Important:** Stereo Mix only mirrors audio going out through *its own* sound
     card (e.g. your onboard Realtek chip). If your Windows default playback device
     is something else — a USB/Bluetooth headset, for example — Stereo Mix will
     capture silence. Either make sure the app/browser you're listening through is
     currently outputting to the same card Stereo Mix belongs to (Settings → per-app
     volume, or the Volume Mixer), or use that other device's own loopback/monitor
     recording device if it has one. This app doesn't automate that per-app routing
     — see [Known limitations](#known-limitations).
5. Naudiodon2 (installed automatically via `npm install`) bundles the PortAudio
   library itself, so you don't need to install PortAudio separately — but it does
   compile its own native addon from source via `node-gyp` on install, so you still
   need a working node-gyp toolchain (Python plus a C/C++ compiler — on Windows,
   the "Desktop development with C++" workload from Visual Studio Build Tools).

## Install & run

```bash
npm install
npm run build
npm start
```

Then open http://localhost:4173 in your browser.

For development with auto-reload:

```bash
npm run dev
```

## Using it

1. Pick your **system audio source** (e.g. "Stereo Mix").
2. Optionally keep **"Also send my microphone"** checked and pick your real mic, so
   your voice still comes through alongside the audio.
3. Pick **Destination** — a `CABLE Input (VB-Audio Virtual Cable)` entry (the app
   defaults to its WASAPI entry, which offers the lowest latency; any of the listed
   entries for the same device should work).
4. Press **Start**.
5. In Discord/WhatsApp call settings, set the microphone/input device to
   `CABLE Output (VB-Audio Virtual Cable)`.
6. Press **Stop** when you're done — your normal microphone setup in Discord/WhatsApp
   is untouched, you just need to switch the input device back.

## Notes

- Your regular speaker/headphone output is untouched — this taps the signal via the
  loopback/Stereo Mix device, it doesn't redirect it.
- Volume sliders control relative levels of the system audio and mic before they're
  mixed. All controls (including these) lock while running — there's no live
  adjustment; press Stop, change the value, then Start again to apply it.
- The **System audio source** and **Your microphone** dropdowns intentionally list
  the same devices — both are just "things Windows can record from", and either one
  (a real mic, Stereo Mix, or a virtual cable's output) can be used as either input.
- The **Destination** dropdown often shows the same virtual cable device three times
  (MME, DirectSound, WASAPI) — these are different Windows audio APIs exposing the
  same physical device; any of them work, WASAPI is generally lowest-latency (the
  app auto-selects it by default).
- There's inherent latency in this pipeline — expect roughly 70-150ms between what
  you hear and what call participants hear. The app requests small capture/output
  buffers (`-audio_buffer_size 50`, ~20ms PortAudio buffers) to keep this low; if you
  hear crackling/dropouts instead, your machine can't keep up with buffers that
  small and they'd need to be raised in [src/audioRouter.ts](src/audioRouter.ts).
- This app currently targets Windows: ffmpeg's `dshow` is used for capture, and
  `naudiodon2` (PortAudio) is used for output since ffmpeg has no live playback
  device of its own on this platform. macOS/Linux would need different capture
  (naudiodon2 can still handle output there).

## Known limitations

- **No automatic per-app audio routing.** If the app/browser you're listening
  through isn't outputting to the same device Stereo Mix mirrors (see
  Prerequisites above), you have to fix that yourself via Windows' Volume Mixer.
  Windows doesn't expose an official, stable API for "set this one app's output
  device" — the only way anything (including Windows' own UI) does it is through
  an undocumented COM interface that's changed across Windows versions before, so
  it isn't automated here.
- **No automatic default-device switching either.** A coarser alternative — the
  app temporarily switching the whole system's default playback device on Start
  and reverting it on Stop — is also not implemented, since it would affect every
  app's audio (notifications, Discord's own sounds, etc.), not just the one you're
  listening through.
