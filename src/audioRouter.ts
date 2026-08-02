import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import * as portAudio from 'naudiodon2';

export interface StartOptions {
  systemSource: string;
  micSource?: string;
  destination: number;
  systemVolume?: number; // 0 - 2 (1 = unity gain)
  micVolume?: number; // 0 - 2
  includeMic?: boolean;
}

export interface RouteStatus {
  running: boolean;
  options?: StartOptions;
  startedAt?: number;
  error?: string;
}

export interface OutputDeviceInfo {
  id: number;
  name: string;
  hostAPIName: string;
  defaultSampleRate: number;
}

function clampVolume(v: number | undefined): number {
  if (v === undefined || Number.isNaN(v)) return 1;
  return Math.min(2, Math.max(0, v));
}

export class AudioRouter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private output: portAudio.IoStreamWrite | null = null;
  private options: StartOptions | null = null;
  private startedAt: number | null = null;
  private lastError: string | undefined;

  checkFfmpeg(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('ffmpeg', ['-version'], (err) => resolve(!err));
    });
  }

  /** Lists DirectShow audio *capture* devices (microphones, Stereo Mix, virtual cable "Output" endpoints, etc). */
  listInputDevices(): Promise<{ audio: string[] }> {
    return new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
        (err, _stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error('ffmpeg was not found on PATH.'));
            return;
          }

          const audio: string[] = [];

          // Newer ffmpeg builds tag each device inline (e.g. `"Name" (audio)`) instead of using a section header.
          for (const m of stderr.matchAll(/"([^"]+)"\s*\(audio\)/g)) {
            audio.push(m[1]);
          }

          if (audio.length === 0) {
            // Older ffmpeg builds group devices under a "DirectShow audio devices" header line instead.
            let inAudioSection = false;
            for (const line of stderr.split(/\r?\n/)) {
              if (line.includes('DirectShow audio devices')) {
                inAudioSection = true;
                continue;
              }
              if (line.includes('DirectShow video devices')) {
                inAudioSection = false;
                continue;
              }
              if (inAudioSection && !line.includes('Alternative name')) {
                const match = line.match(/"([^"]+)"/);
                if (match) audio.push(match[1]);
              }
            }
          }

          if (audio.length === 0 && !/DirectShow|\(audio\)/.test(stderr)) {
            reject(new Error('Could not enumerate devices. Is ffmpeg installed and available on PATH?'));
            return;
          }

          resolve({ audio });
        }
      );
    });
  }

  /** Lists playback devices (via PortAudio) that audio can be sent to, e.g. "CABLE Input". */
  listOutputDevices(): OutputDeviceInfo[] {
    return portAudio
      .getDevices()
      .filter((d) => d.maxOutputChannels > 0)
      .map((d) => ({
        id: d.id,
        name: d.name,
        hostAPIName: d.hostAPIName,
        defaultSampleRate: d.defaultSampleRate,
      }));
  }

  getStatus(): RouteStatus {
    return {
      running: this.proc !== null,
      options: this.options ?? undefined,
      startedAt: this.startedAt ?? undefined,
      error: this.lastError,
    };
  }

  start(opts: StartOptions): void {
    if (this.proc) {
      throw new Error('Routing is already running. Stop it first.');
    }
    if (!opts.systemSource) throw new Error('Choose a system audio source device.');
    if (opts.destination === undefined || opts.destination === null || Number.isNaN(opts.destination)) {
      throw new Error('Choose a destination playback device.');
    }

    const deviceInfo = portAudio.getDevices().find((d) => d.id === opts.destination);
    if (!deviceInfo) throw new Error('The selected destination device is no longer available.');
    const sampleRate = deviceInfo.defaultSampleRate || 48000;

    const systemVolume = clampVolume(opts.systemVolume);
    const micVolume = clampVolume(opts.micVolume);
    const includeMic = !!opts.includeMic && !!opts.micSource;

    const args: string[] = ['-hide_banner', '-loglevel', 'error'];
    // A low explicit buffer size (ms) keeps dshow's own capture latency down; ffmpeg's device
    // default is often several hundred ms otherwise. Low probesize/analyzeduration speed up startup.
    const captureOpts = ['-audio_buffer_size', '50', '-probesize', '32', '-analyzeduration', '0'];
    args.push('-f', 'dshow', ...captureOpts, '-i', `audio=${opts.systemSource}`);
    if (includeMic) {
      args.push('-f', 'dshow', ...captureOpts, '-i', `audio=${opts.micSource}`);
    }

    const filterComplex = includeMic
      ? `[0:a]volume=${systemVolume}[a0];[1:a]volume=${micVolume}[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[out]`
      : `[0:a]volume=${systemVolume}[out]`;
    args.push('-filter_complex', filterComplex, '-map', '[out]');
    // Raw PCM piped to stdout; naudiodon2/PortAudio plays it to the chosen device (this ffmpeg build has no live output device of its own).
    args.push('-f', 's16le', '-ar', String(sampleRate), '-ac', '2', 'pipe:1');

    this.lastError = undefined;
    const proc = spawn('ffmpeg', args);
    const output = portAudio.AudioIO({
      outOptions: {
        deviceId: opts.destination,
        channelCount: 2,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate,
        // Small buffer/queue for lower output latency, at some risk of underrun glitches on a slow machine.
        framesPerBuffer: Math.round(sampleRate * 0.02), // ~20ms
        maxQueue: 2,
        closeOnError: true,
      },
    });

    this.proc = proc;
    this.output = output;
    this.options = { ...opts, systemVolume, micVolume, includeMic };
    this.startedAt = Date.now();

    proc.stdout.pipe(output);
    output.start();

    let stderrTail = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    const teardown = () => {
      this.proc = null;
      this.options = null;
      this.startedAt = null;
      if (this.output === output) {
        this.output = null;
        output.quit();
      }
    };
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        this.lastError = `ffmpeg exited with code ${code}: ${stderrTail.trim().slice(-500)}`;
      }
      teardown();
    });
    proc.on('error', (err) => {
      this.lastError = err.message;
      teardown();
    });
  }

  stop(): void {
    const proc = this.proc;
    const output = this.output;
    if (!proc) return;
    try {
      // Ask ffmpeg to quit gracefully first.
      proc.stdin.write('q');
    } catch {
      // stdin may already be closed; fall through to the force-kill timer.
    }
    const forceKill = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 2000);
    proc.once('exit', () => clearTimeout(forceKill));

    this.proc = null;
    this.options = null;
    this.startedAt = null;
    if (this.output === output) {
      this.output = null;
      output?.quit();
    }
  }
}
