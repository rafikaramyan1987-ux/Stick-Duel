/**
 * Topple Duel audio. Impacts, breaking and the menus use Kenney CC0 samples (Impact Sounds,
 * Interface Sounds; src/assets/sfx, inlined into the build); explosions, whooshes, jingles and the
 * looping music are synthesised with the Web Audio API. Safe to import and call in environments
 * without an AudioContext (all methods become silent no-ops).
 */
const SAMPLE_URLS = (typeof import.meta.glob === 'function'
  ? import.meta.glob('../assets/sfx/*.mp3', { query: '?url', import: 'default', eager: true })
  : {}) as Record<string, string>;

/** Sample groups: a random variant of the group is played (wood_heavy_0, wood_heavy_1 …). */
export type SampleGroup =
  | 'wood_heavy'
  | 'wood_med'
  | 'wood_light'
  | 'plank'
  | 'stone'
  | 'plate_heavy'
  | 'metal_heavy'
  | 'metal_light'
  | 'punch_med'
  | 'punch_heavy'
  | 'soft_heavy'
  | 'soft_med'
  | 'glass'
  | 'ui_click'
  | 'ui_select'
  | 'ui_confirm'
  | 'ui_open'
  | 'ui_close'
  | 'ui_error'
  | 'ui_switch'
  | 'ui_star'
  | 'ui_pluck'
  | 'ui_toggle';

export type SfxName =
  | 'twang'
  | 'whoosh'
  | 'spin'
  | 'magic'
  | 'thud'
  | 'clink'
  | 'hit'
  | 'headshot'
  | 'explosion'
  | 'ko'
  | 'click'
  | 'coin'
  | 'star'
  | 'win'
  | 'lose'
  | 'boss'
  | 'crumble'
  | 'splash'
  | 'tick'
  | 'turn'
  | 'wind';

export type MusicTrack = 'menu' | 'forest' | 'castle' | 'mountains' | 'desert' | 'snow' | 'volcano';

export interface PlayOptions {
  pitch?: number;
  volume?: number;
  index?: number;
}

/* ------------------------------------------------------------------ */
/* Low-level synth helpers                                             */
/* ------------------------------------------------------------------ */

const MIN_GAIN = 0.0001;

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
}

interface ToneSpec {
  type: OscillatorType;
  freq: number;
  /** Optional target frequency, reached after `glide` seconds (exponential). */
  freqEnd?: number;
  glide?: number;
  t: number;
  attack?: number;
  hold?: number;
  decay: number;
  vol: number;
  filter?: FilterSpec;
  vibrato?: { rate: number; depth: number };
  detune?: number;
}

interface NoiseSpec {
  t: number;
  attack?: number;
  hold?: number;
  decay: number;
  vol: number;
  filter: FilterSpec;
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Creates an envelope gain: silence -> peak (linear) -> hold -> exponential decay. Returns end time. */
function applyEnvelope(g: GainNode, t: number, attack: number, hold: number, decay: number, vol: number): number {
  const peak = Math.max(MIN_GAIN * 2, vol);
  const tPeak = t + Math.max(0.002, attack);
  const tHold = tPeak + Math.max(0, hold);
  const end = tHold + Math.max(0.01, decay);
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.linearRampToValueAtTime(peak, tPeak);
  if (hold > 0) g.gain.setValueAtTime(peak, tHold);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
  return end;
}

function makeFilter(ctx: BaseAudioContext, spec: FilterSpec, t: number, end: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = spec.type;
  f.Q.value = spec.q ?? 0.7;
  f.frequency.setValueAtTime(spec.freq, t);
  if (spec.freqEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), end);
  }
  return f;
}

function tone(ctx: BaseAudioContext, dest: AudioNode, s: ToneSpec): void {
  const o = ctx.createOscillator();
  o.type = s.type;
  const freq = Math.max(20, s.freq);
  o.frequency.setValueAtTime(freq, s.t);
  if (s.freqEnd !== undefined) {
    o.frequency.exponentialRampToValueAtTime(Math.max(20, s.freqEnd), s.t + (s.glide ?? s.decay));
  }
  if (s.detune) o.detune.value = s.detune;

  const g = ctx.createGain();
  const end = applyEnvelope(g, s.t, s.attack ?? 0.005, s.hold ?? 0, s.decay, s.vol);
  const nodes: AudioNode[] = [o, g];

  if (s.filter) {
    const f = makeFilter(ctx, s.filter, s.t, end);
    o.connect(f);
    f.connect(g);
    nodes.push(f);
  } else {
    o.connect(g);
  }
  g.connect(dest);

  if (s.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = s.vibrato.rate;
    const lg = ctx.createGain();
    lg.gain.value = s.vibrato.depth;
    lfo.connect(lg);
    lg.connect(o.frequency);
    nodes.push(lfo, lg);
    lfo.start(s.t);
    lfo.stop(end + 0.05);
  }

  o.start(s.t);
  o.stop(end + 0.05);
  o.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, buf: AudioBuffer, s: NoiseSpec): void {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = ctx.createGain();
  const end = applyEnvelope(g, s.t, s.attack ?? 0.003, s.hold ?? 0, s.decay, s.vol);
  const f = makeFilter(ctx, s.filter, s.t, end);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  // Random offset so repeated bursts do not sound identical.
  src.start(s.t, Math.random() * Math.max(0, buf.duration - 0.1));
  src.stop(end + 0.05);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/* ------------------------------------------------------------------ */
/* Music definitions                                                   */
/* ------------------------------------------------------------------ */

type LeadKind = 'pluck' | 'flute' | 'lute' | 'horn' | 'oud' | 'bell' | 'dark';

interface TrackDef {
  bpm: number;
  /** MIDI note of the tonic for the melody. */
  root: number;
  /** Scale as semitone offsets. */
  scale: number[];
  /** One string per bar, 8 eighth-note tokens: degree number, '.' rest, '-' hold. */
  melody: string[];
  /** Bass root per bar, semitone offset from tonic. */
  chords: number[];
  /** 8 chars: 'x' root, 'o' fifth, '.' nothing. */
  bass: string;
  /** Drum patterns cycling per bar, 8 chars: k kick, t tom, T high tom, s snare, h tick. */
  drums: string[];
  lead: LeadKind;
  leadVol: number;
  bassVol: number;
  drumVol: number;
  pad?: boolean;
  extra?: 'birds' | 'sparkle';
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 2, 4, 7, 9];
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];

const TRACKS: Record<MusicTrack, TrackDef> = {
  menu: {
    bpm: 112,
    root: 72,
    scale: MAJOR,
    melody: [
      '4 . 4 5 7 - 5 4',
      '6 - 4 . 1 2 4 -',
      '5 . 5 4 2 - 4 5',
      '3 - 2 . 0 - . .',
      '4 . 4 5 7 - 9 7',
      '8 - 7 5 3 - 5 -',
      '4 5 6 4 1 - 2 3',
      '0 - - . 7 . . .',
    ],
    chords: [0, 7, 9, 5, 0, 5, 7, 0],
    bass: 'x..xo...',
    drums: ['k...s...', 'k..ks...'],
    lead: 'pluck',
    leadVol: 0.32,
    bassVol: 0.35,
    drumVol: 0.35,
  },
  forest: {
    bpm: 96,
    root: 67,
    scale: PENTA,
    melody: [
      '2 - 3 4 - . 3 2',
      '1 - 2 . 0 - . .',
      '2 - 3 4 5 - 4 3',
      '4 - - . 3 . 2 .',
      '5 - 6 5 4 - 3 4',
      '3 - 2 . 1 - 2 .',
      '2 3 4 . 3 2 1 .',
      '0 - - - . . . .',
    ],
    chords: [0, 5, 7, 0, -3, 5, 7, 0],
    bass: 'x...o...',
    drums: ['h...h...'],
    lead: 'flute',
    leadVol: 0.3,
    bassVol: 0.32,
    drumVol: 0.2,
    extra: 'birds',
  },
  castle: {
    bpm: 100,
    root: 62,
    scale: DORIAN,
    melody: [
      '0 . 2 3 4 - 3 2',
      '1 - 0 . -1 - . .',
      '0 . 2 3 4 5 6 5',
      '4 - - . 3 . 2 .',
      '4 . 4 5 6 - 5 4',
      '3 - 2 3 1 - . .',
      '2 3 4 2 1 . -1 .',
      '0 - - . . . . .',
    ],
    chords: [0, -2, 0, -5, 0, 3, -2, 0],
    bass: 'x...x.o.',
    drums: ['k..hs.h.', 'k..hs.hh'],
    lead: 'lute',
    leadVol: 0.34,
    bassVol: 0.3,
    drumVol: 0.3,
  },
  mountains: {
    bpm: 92,
    root: 64,
    scale: DORIAN,
    melody: [
      '0 - - 2 4 - - -',
      '3 - 2 - 1 - - -',
      '0 - - 2 4 - 5 -',
      '6 - - - 5 - - -',
      '7 - - 6 5 - 4 -',
      '5 - - 4 3 - - -',
      '4 - 3 - 1 - 2 -',
      '0 - - - - - . .',
    ],
    chords: [0, -2, 0, 3, 5, 0, -2, 0],
    bass: 'x.......',
    drums: ['k...k...', 'k...k..h'],
    lead: 'horn',
    leadVol: 0.26,
    bassVol: 0.3,
    drumVol: 0.4,
    pad: true,
  },
  desert: {
    bpm: 104,
    root: 62,
    scale: HIJAZ,
    melody: [
      '0 1 2 . 2 1 2 3',
      '4 - 3 2 1 - 0 .',
      '4 . 4 5 4 3 2 3',
      '2 - 1 - 0 - . .',
      '7 - 6 5 4 . 5 4',
      '3 2 1 2 3 - . .',
      '2 1 2 3 2 1 0 1',
      '0 - - . . . . .',
    ],
    chords: [0, 0, -2, 0, 0, 1, -2, 0],
    bass: 'x..x..o.',
    drums: ['kh.hk.h.', 'kh.hk.hh'],
    lead: 'oud',
    leadVol: 0.32,
    bassVol: 0.3,
    drumVol: 0.35,
  },
  snow: {
    bpm: 90,
    root: 77,
    scale: MAJOR,
    melody: [
      '4 . . 2 . . 0 .',
      '3 . . 2 . 1 . .',
      '4 . . 5 . . 7 .',
      '6 . 5 . 4 . . .',
      '7 . . 6 . . 5 .',
      '4 . 2 . 3 . . .',
      '2 . 4 . 1 . 3 .',
      '0 . . . 7 . . .',
    ],
    chords: [0, 5, 7, 0, -3, 5, 7, 0],
    bass: 'x...o...',
    drums: ['........'],
    lead: 'bell',
    leadVol: 0.26,
    bassVol: 0.26,
    drumVol: 0,
    extra: 'sparkle',
  },
  volcano: {
    bpm: 116,
    root: 57,
    scale: MINOR,
    melody: [
      '0 . 0 2 3 . 2 0',
      '4 - 3 . 2 - . .',
      '0 . 0 2 3 . 5 4',
      '3 - 2 . -1 - . .',
      '4 . 4 5 4 3 2 3',
      '2 - 0 . 2 - 3 .',
      '4 3 2 0 2 . -2 .',
      '0 - - . . . . .',
    ],
    chords: [0, 0, -4, -2, 0, 0, -4, -5],
    bass: 'x.x.x.o.',
    drums: ['k.t.k.T.', 'k.tkT.t.'],
    lead: 'dark',
    leadVol: 0.3,
    bassVol: 0.34,
    drumVol: 0.42,
  },
};

interface ParsedTrack {
  def: TrackDef;
  /** Per step: [degree, lengthInSteps] or null. */
  notes: ([number, number] | null)[];
  steps: number;
  stepDur: number;
}

function parseTrack(def: TrackDef): ParsedTrack {
  const notes: ([number, number] | null)[] = [];
  for (const bar of def.melody) {
    const toks = bar.trim().split(/\s+/);
    for (let i = 0; i < 8; i++) {
      const tok = toks[i] ?? '.';
      const deg = Number(tok);
      if (tok === '.' || tok === '-' || Number.isNaN(deg)) {
        notes.push(null);
        continue;
      }
      let len = 1;
      while (i + len < 8 && toks[i + len] === '-') len++;
      notes.push([deg, len]);
    }
  }
  return { def, notes, steps: notes.length, stepDur: 60 / def.bpm / 2 };
}

function degreeToSemis(deg: number, scale: number[]): number {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return (scale[idx] ?? 0) + 12 * oct;
}

/* ------------------------------------------------------------------ */
/* Audio engine                                                        */
/* ------------------------------------------------------------------ */

type AudioCtor = typeof AudioContext;

function getAudioCtor(): AudioCtor | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { webkitAudioContext?: AudioCtor };
    if (w.webkitAudioContext) return w.webkitAudioContext;
  }
  return null;
}

const LOOKAHEAD = 0.2;
const SCHED_INTERVAL_MS = 50;
const CROSSFADE = 0.6;
const MASTER_GAIN = 0.5;
const MUSIC_GAIN = 0.18;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private sfxEnabled = true;
  private musicEnabled = true;
  private muted = false;

  /** Track requested by the game (kept even while music is silenced). */
  private wantedTrack: MusicTrack | null = null;
  /** Track currently being scheduled. */
  private playing: ParsedTrack | null = null;
  private playingName: MusicTrack | null = null;
  private trackGain: GainNode | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private samples = new Map<string, AudioBuffer[]>();
  private samplesLoading = false;

  private loadSamples(ctx: AudioContext): void {
    if (this.samplesLoading) return;
    this.samplesLoading = true;
    for (const [path, url] of Object.entries(SAMPLE_URLS)) {
      const file = path.split('/').pop()!.replace('.mp3', '');
      const group = /_\d+$/.test(file) ? file.replace(/_\d+$/, '') : file;
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => {
          const list = this.samples.get(group) ?? [];
          list.push(buf);
          this.samples.set(group, list);
        })
        .catch(() => undefined);
    }
  }

  /** Plays a Kenney sample (random variant of the group). */
  sample(group: SampleGroup, opts?: PlayOptions): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.sfxBus || !this.sfxEnabled || this.muted || ctx.state !== 'running') return;
      const list = this.samples.get(group);
      if (!list || list.length === 0) return;
      const buf = list[Math.floor(Math.random() * list.length)]!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = clamp((opts?.pitch ?? 1) * (0.94 + Math.random() * 0.12), 0.4, 3);
      const g = ctx.createGain();
      g.gain.value = clamp(opts?.volume ?? 1, 0, 1) * 0.9;
      src.connect(g);
      g.connect(this.sfxBus);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      src.start();
    } catch {
      /* never throw */
    }
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = getAudioCtor();
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.buildGraph(this.ctx);
        this.loadSamples(this.ctx);
      }
      const ctx = this.ctx;
      if (ctx.state === 'suspended') {
        // iOS needs a sound started inside the gesture.
        this.primeSilence(ctx);
        ctx
          .resume()
          .then(() => this.refreshMusic())
          .catch(() => undefined);
      }
      this.refreshMusic();
    } catch {
      /* audio unavailable */
    }
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    this.safeRefresh();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (this.ctx && this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, t, 0.05);
      }
    } catch {
      /* ignore */
    }
    this.safeRefresh();
  }

  play(name: SfxName, opts?: PlayOptions): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.sfxBus || !this.noise) return;
      if (!this.sfxEnabled || this.muted) return;
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => undefined);
        return;
      }
      const pitch = clamp(opts?.pitch ?? 1, 0.25, 4);
      const vol = clamp(opts?.volume ?? 1, 0, 1);
      if (vol <= 0) return;
      // Per-sound gain so `volume` scales the whole effect.
      const out = ctx.createGain();
      out.gain.value = vol;
      out.connect(this.sfxBus);
      const dur = this.renderSfx(ctx, out, this.noise, name, ctx.currentTime + 0.005, pitch, opts?.index ?? 0);
      setTimeout(() => out.disconnect(), (dur + 0.3) * 1000);
    } catch {
      /* never throw */
    }
  }

  music(track: MusicTrack | null): void {
    this.wantedTrack = track;
    this.safeRefresh();
  }

  /* ---------------- internals ---------------- */

  private buildGraph(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;
    master.connect(comp);

    const sfx = ctx.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);

    const mus = ctx.createGain();
    mus.gain.value = MUSIC_GAIN;
    mus.connect(master);

    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.master = master;
    this.sfxBus = sfx;
    this.musicBus = mus;
    this.noise = buf;
  }

  private primeSilence(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
      src.onended = () => src.disconnect();
    } catch {
      /* ignore */
    }
  }

  private safeRefresh(): void {
    try {
      this.refreshMusic();
    } catch {
      /* ignore */
    }
  }

  private refreshMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const shouldPlay = this.musicEnabled && !this.muted && this.wantedTrack !== null;
    if (!shouldPlay) {
      if (this.playing) this.stopTrack();
      return;
    }
    if (this.wantedTrack !== null && this.playingName !== this.wantedTrack) {
      this.startTrack(ctx, this.wantedTrack);
    }
  }

  private fadeOutCurrent(ctx: AudioContext): void {
    const g = this.trackGain;
    if (!g) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + CROSSFADE);
    setTimeout(() => g.disconnect(), (CROSSFADE + LOOKAHEAD + 0.5) * 1000);
    this.trackGain = null;
  }

  private startTrack(ctx: AudioContext, name: MusicTrack): void {
    if (!this.musicBus) return;
    this.fadeOutCurrent(ctx);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + CROSSFADE);
    g.connect(this.musicBus);
    this.trackGain = g;
    this.playing = parseTrack(TRACKS[name]);
    this.playingName = name;
    this.step = 0;
    this.nextTime = t + 0.08;
    if (this.timer === null) {
      this.timer = setInterval(() => this.schedulerTick(), SCHED_INTERVAL_MS);
    }
  }

  private stopTrack(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) this.fadeOutCurrent(this.ctx);
    this.playing = null;
    this.playingName = null;
  }

  private schedulerTick(): void {
    try {
      const ctx = this.ctx;
      const tr = this.playing;
      const dest = this.trackGain;
      if (!ctx || !tr || !dest || !this.noise) return;
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // Recover after the tab was throttled: don't burst-play missed notes.
      if (this.nextTime < now - 0.1) this.nextTime = now + 0.05;
      while (this.nextTime < now + LOOKAHEAD) {
        this.scheduleStep(ctx, dest, this.noise, tr, this.step, this.nextTime);
        this.step = (this.step + 1) % tr.steps;
        this.nextTime += tr.stepDur;
      }
    } catch {
      /* ignore */
    }
  }

  private scheduleStep(
    ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    tr: ParsedTrack,
    step: number,
    t: number,
  ): void {
    const d = tr.def;
    const bar = Math.floor(step / 8);
    const pos = step % 8;
    const sd = tr.stepDur;
    const chord = d.chords[bar % d.chords.length] ?? 0;

    // Melody
    const n = tr.notes[step];
    if (n) {
      const [deg, len] = n;
      const f = midiToFreq(d.root + degreeToSemis(deg, d.scale));
      playLead(ctx, dest, d.lead, f, t, len * sd, d.leadVol);
    }

    // Bass
    const b = d.bass[pos];
    if (b === 'x' || b === 'o') {
      const semis = chord + (b === 'o' ? 7 : 0);
      const f = midiToFreq(d.root - 24 + semis);
      tone(ctx, dest, {
        type: 'triangle',
        freq: f,
        t,
        attack: 0.01,
        decay: sd * 1.8,
        vol: d.bassVol,
        filter: { type: 'lowpass', freq: 600 },
      });
    }

    // Pad (sustained chord per bar)
    if (d.pad && pos === 0) {
      const barDur = sd * 8;
      for (const iv of [0, 7, 15]) {
        tone(ctx, dest, {
          type: 'sawtooth',
          freq: midiToFreq(d.root - 12 + chord + iv),
          t,
          attack: barDur * 0.35,
          hold: barDur * 0.35,
          decay: barDur * 0.45,
          vol: 0.07,
          detune: iv === 7 ? 6 : -4,
          filter: { type: 'lowpass', freq: 700, q: 0.5 },
        });
      }
    }

    // Drums
    if (d.drumVol > 0) {
      const pat = d.drums[bar % d.drums.length] ?? '';
      const c = pat[pos];
      const v = d.drumVol;
      if (c === 'k') drumKick(ctx, dest, t, v);
      else if (c === 't') drumTom(ctx, dest, noise, t, v, 110);
      else if (c === 'T') drumTom(ctx, dest, noise, t, v, 160);
      else if (c === 's') drumSnare(ctx, dest, noise, t, v * 0.7);
      else if (c === 'h') drumTick(ctx, dest, noise, t, v * 0.6);
    }

    // Character extras
    if (d.extra === 'birds' && bar % 2 === 1 && pos === 5) {
      const base = 2200 + (bar % 4) * 180;
      for (let i = 0; i < 2; i++) {
        tone(ctx, dest, {
          type: 'sine',
          freq: base * (1 + i * 0.08),
          freqEnd: base * (1.25 + i * 0.08),
          glide: 0.05,
          t: t + i * 0.08,
          attack: 0.005,
          decay: 0.07,
          vol: 0.07,
        });
      }
    } else if (d.extra === 'sparkle' && bar % 2 === 0 && pos === 7) {
      const deg = [4, 7, 9, 11][(bar / 2) % 4] ?? 7;
      playLead(ctx, dest, 'bell', midiToFreq(d.root + 12 + degreeToSemis(deg, d.scale)), t, sd, 0.1);
    }
  }

  /** Renders a sound effect; returns approximate duration in seconds. */
  private renderSfx(
    ctx: AudioContext,
    out: AudioNode,
    nb: AudioBuffer,
    name: SfxName,
    t: number,
    p: number,
    index: number,
  ): number {
    switch (name) {
      case 'twang': {
        tone(ctx, out, {
          type: 'sawtooth',
          freq: 340 * p,
          freqEnd: 300 * p,
          glide: 0.08,
          t,
          attack: 0.003,
          decay: 0.3,
          vol: 0.35,
          filter: { type: 'lowpass', freq: 2600, freqEnd: 350, q: 4 },
        });
        tone(ctx, out, { type: 'triangle', freq: 680 * p, t, decay: 0.12, vol: 0.18 });
        noiseBurst(ctx, out, nb, { t, decay: 0.03, vol: 0.12, filter: { type: 'highpass', freq: 3000 } });
        return 0.35;
      }
      case 'whoosh': {
        noiseBurst(ctx, out, nb, {
          t,
          attack: 0.12,
          decay: 0.28,
          vol: 0.45,
          filter: { type: 'bandpass', freq: 400 * p, freqEnd: 2200 * p, q: 1.2 },
        });
        return 0.42;
      }
      case 'spin': {
        for (let i = 0; i < 4; i++) {
          noiseBurst(ctx, out, nb, {
            t: t + i * 0.09,
            attack: 0.03,
            decay: 0.06,
            vol: 0.3 - i * 0.04,
            filter: { type: 'bandpass', freq: (900 + i * 250) * p, q: 2.5 },
          });
        }
        tone(ctx, out, {
          type: 'triangle',
          freq: 180 * p,
          freqEnd: 260 * p,
          t,
          attack: 0.03,
          decay: 0.35,
          vol: 0.08,
          vibrato: { rate: 22, depth: 30 },
        });
        return 0.42;
      }
      case 'magic': {
        const notes = [84, 88, 91, 96, 100];
        notes.forEach((m, i) => {
          tone(ctx, out, { type: 'sine', freq: midiToFreq(m) * p, t: t + i * 0.05, decay: 0.35, vol: 0.18 });
          tone(ctx, out, { type: 'triangle', freq: midiToFreq(m + 12) * p, t: t + i * 0.05, decay: 0.12, vol: 0.05 });
        });
        noiseBurst(ctx, out, nb, {
          t,
          attack: 0.1,
          decay: 0.3,
          vol: 0.07,
          filter: { type: 'highpass', freq: 6000 },
        });
        return 0.6;
      }
      case 'thud': {
        tone(ctx, out, { type: 'sine', freq: 150 * p, freqEnd: 60 * p, glide: 0.12, t, decay: 0.18, vol: 0.55 });
        noiseBurst(ctx, out, nb, { t, decay: 0.07, vol: 0.25, filter: { type: 'lowpass', freq: 900 * p } });
        return 0.2;
      }
      case 'clink': {
        tone(ctx, out, { type: 'sine', freq: 2400 * p, t, decay: 0.14, vol: 0.16 });
        tone(ctx, out, { type: 'sine', freq: 3620 * p, t, decay: 0.08, vol: 0.08 });
        tone(ctx, out, { type: 'triangle', freq: 1800 * p, t: t + 0.04, decay: 0.08, vol: 0.08 });
        return 0.18;
      }
      case 'hit': {
        tone(ctx, out, { type: 'sine', freq: 320 * p, freqEnd: 110 * p, glide: 0.12, t, decay: 0.18, vol: 0.5 });
        tone(ctx, out, { type: 'triangle', freq: 640 * p, freqEnd: 220 * p, glide: 0.06, t, decay: 0.08, vol: 0.15 });
        noiseBurst(ctx, out, nb, { t, decay: 0.05, vol: 0.18, filter: { type: 'lowpass', freq: 1400 } });
        return 0.2;
      }
      case 'headshot': {
        const f = 1318.5 * p;
        tone(ctx, out, { type: 'sine', freq: f, t, decay: 0.7, vol: 0.28 });
        tone(ctx, out, { type: 'sine', freq: f * 2.76, t, decay: 0.25, vol: 0.06 });
        tone(ctx, out, { type: 'triangle', freq: f * 2, t, decay: 0.15, vol: 0.06 });
        for (let i = 0; i < 3; i++) {
          tone(ctx, out, {
            type: 'sine',
            freq: f * (1.5 + i * 0.5),
            t: t + 0.08 + i * 0.06,
            decay: 0.12,
            vol: 0.07,
          });
        }
        return 0.75;
      }
      case 'explosion': {
        noiseBurst(ctx, out, nb, {
          t,
          attack: 0.01,
          decay: 0.85,
          vol: 0.55,
          filter: { type: 'lowpass', freq: 1400 * p, freqEnd: 120, q: 0.8 },
        });
        tone(ctx, out, { type: 'sine', freq: 95 * p, freqEnd: 40 * p, glide: 0.5, t, decay: 0.6, vol: 0.45 });
        return 0.9;
      }
      case 'ko': {
        tone(ctx, out, {
          type: 'sine',
          freq: 950 * p,
          freqEnd: 200 * p,
          glide: 0.75,
          t,
          attack: 0.03,
          hold: 0.45,
          decay: 0.35,
          vol: 0.3,
          vibrato: { rate: 7, depth: 18 },
        });
        tone(ctx, out, {
          type: 'triangle',
          freq: 950 * p,
          freqEnd: 200 * p,
          glide: 0.75,
          t,
          attack: 0.03,
          hold: 0.4,
          decay: 0.3,
          vol: 0.08,
        });
        return 0.85;
      }
      case 'click': {
        tone(ctx, out, { type: 'sine', freq: 950 * p, freqEnd: 700 * p, glide: 0.04, t, decay: 0.05, vol: 0.25 });
        return 0.06;
      }
      case 'coin': {
        const spec = { type: 'square' as OscillatorType, filter: { type: 'lowpass' as BiquadFilterType, freq: 3500 } };
        tone(ctx, out, { ...spec, freq: 987.8 * p, t, decay: 0.08, hold: 0.05, vol: 0.12 });
        tone(ctx, out, { ...spec, freq: 1318.5 * p, t: t + 0.08, hold: 0.06, decay: 0.3, vol: 0.12 });
        return 0.45;
      }
      case 'star': {
        const steps = [0, 4, 7, 12, 16, 19, 24];
        const i = clamp(Math.floor(index), 0, steps.length - 1);
        const f = midiToFreq(84 + (steps[i] ?? 0)) * p;
        tone(ctx, out, { type: 'sine', freq: f, t, decay: 0.6, vol: 0.28 });
        tone(ctx, out, { type: 'sine', freq: f * 2.76, t, decay: 0.2, vol: 0.05 });
        tone(ctx, out, { type: 'triangle', freq: f * 0.5, t, decay: 0.3, vol: 0.1 });
        noiseBurst(ctx, out, nb, { t, attack: 0.02, decay: 0.25, vol: 0.06, filter: { type: 'highpass', freq: 7000 } });
        return 0.65;
      }
      case 'win': {
        const seq: [number, number, number][] = [
          [72, 0, 0.12],
          [76, 0.12, 0.12],
          [79, 0.24, 0.12],
          [84, 0.36, 0.25],
          [79, 0.62, 0.12],
          [84, 0.74, 0.7],
        ];
        for (const [m, dt, len] of seq) {
          const f = midiToFreq(m) * p;
          tone(ctx, out, { type: 'triangle', freq: f, t: t + dt, hold: len * 0.6, decay: len, vol: 0.25 });
          tone(ctx, out, { type: 'sine', freq: f * 2, t: t + dt, decay: len * 0.6, vol: 0.06 });
        }
        // Harmony chord at the end.
        for (const m of [64, 67]) {
          tone(ctx, out, { type: 'sine', freq: midiToFreq(m) * p, t: t + 0.74, hold: 0.3, decay: 0.5, vol: 0.12 });
        }
        drumSnare(ctx, out, nb, t + 0.74, 0.25);
        return 1.6;
      }
      case 'lose': {
        const seq: [number, number, number][] = [
          [67, 0, 0.28],
          [66, 0.32, 0.28],
          [65, 0.64, 0.28],
          [64, 0.96, 0.6],
        ];
        seq.forEach(([m, dt, len], i) => {
          const f = midiToFreq(m - 12) * p;
          tone(ctx, out, {
            type: 'sawtooth',
            freq: f * 1.03,
            freqEnd: f,
            glide: 0.08,
            t: t + dt,
            attack: 0.04,
            hold: len * 0.5,
            decay: len * 0.6,
            vol: 0.2,
            filter: { type: 'lowpass', freq: 700, freqEnd: 400, q: 2 },
            vibrato: i === 3 ? { rate: 6, depth: 6 } : undefined,
          });
        });
        return 1.6;
      }
      case 'boss': {
        // Drum roll: accelerating, crescendo.
        let dt = 0;
        for (let i = 0; i < 18; i++) {
          const v = 0.08 + (i / 18) * 0.22;
          noiseBurst(ctx, out, nb, {
            t: t + dt,
            decay: 0.06,
            vol: v,
            filter: { type: 'bandpass', freq: 1500, q: 1.2 },
          });
          dt += Math.max(0.035, 0.08 - i * 0.003);
        }
        const hit = t + dt + 0.02;
        drumKick(ctx, out, hit, 0.6);
        for (const [m, det] of [
          [48, -5],
          [55, 4],
          [60, 0],
        ] as [number, number][]) {
          tone(ctx, out, {
            type: 'sawtooth',
            freq: midiToFreq(m) * p,
            t: hit,
            attack: 0.03,
            hold: 0.25,
            decay: 0.5,
            vol: 0.14,
            detune: det,
            filter: { type: 'lowpass', freq: 1500, freqEnd: 300, q: 1 },
          });
        }
        return dt + 0.85;
      }
      case 'crumble': {
        for (let i = 0; i < 10; i++) {
          noiseBurst(ctx, out, nb, {
            t: t + i * 0.05 + Math.random() * 0.03,
            decay: 0.05 + Math.random() * 0.06,
            vol: 0.22 * (1 - i / 14),
            filter: { type: 'bandpass', freq: (300 + Math.random() * 1200) * p, q: 1.5 },
          });
        }
        noiseBurst(ctx, out, nb, {
          t,
          attack: 0.05,
          decay: 0.5,
          vol: 0.15,
          filter: { type: 'lowpass', freq: 500 * p, freqEnd: 150 },
        });
        return 0.65;
      }
      case 'splash': {
        tone(ctx, out, { type: 'sine', freq: 220 * p, freqEnd: 900 * p, glide: 0.12, t, decay: 0.16, vol: 0.4 });
        tone(ctx, out, {
          type: 'sine',
          freq: 320 * p,
          freqEnd: 1100 * p,
          glide: 0.08,
          t: t + 0.13,
          decay: 0.1,
          vol: 0.22,
        });
        noiseBurst(ctx, out, nb, {
          t: t + 0.02,
          attack: 0.03,
          decay: 0.3,
          vol: 0.14,
          filter: { type: 'bandpass', freq: 1200 * p, freqEnd: 500, q: 0.8 },
        });
        return 0.35;
      }
      case 'tick': {
        tone(ctx, out, { type: 'sine', freq: 1500 * p, t, decay: 0.035, vol: 0.14 });
        return 0.05;
      }
      case 'turn': {
        tone(ctx, out, { type: 'sine', freq: 784 * p, t, decay: 0.35, vol: 0.2 });
        tone(ctx, out, { type: 'sine', freq: 1046.5 * p, t: t + 0.12, decay: 0.5, vol: 0.2 });
        tone(ctx, out, { type: 'sine', freq: 2093 * p, t: t + 0.12, decay: 0.2, vol: 0.04 });
        return 0.65;
      }
      case 'wind': {
        noiseBurst(ctx, out, nb, {
          t,
          attack: 0.4,
          hold: 0.1,
          decay: 0.55,
          vol: 0.35,
          filter: { type: 'bandpass', freq: 450 * p, freqEnd: 900 * p, q: 0.9 },
        });
        noiseBurst(ctx, out, nb, {
          t: t + 0.15,
          attack: 0.3,
          decay: 0.5,
          vol: 0.12,
          filter: { type: 'bandpass', freq: 1400 * p, freqEnd: 700 * p, q: 3 },
        });
        return 1.05;
      }
      default:
        return 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Music instruments                                                   */
/* ------------------------------------------------------------------ */

function playLead(
  ctx: BaseAudioContext,
  dest: AudioNode,
  kind: LeadKind,
  f: number,
  t: number,
  len: number,
  vol: number,
): void {
  switch (kind) {
    case 'pluck':
      tone(ctx, dest, { type: 'triangle', freq: f, t, attack: 0.005, decay: Math.min(0.6, len + 0.2), vol });
      tone(ctx, dest, { type: 'sine', freq: f * 2, t, attack: 0.005, decay: 0.12, vol: vol * 0.25 });
      break;
    case 'flute':
      tone(ctx, dest, {
        type: 'sine',
        freq: f,
        t,
        attack: 0.05,
        hold: len * 0.6,
        decay: len * 0.5 + 0.1,
        vol,
        vibrato: len > 0.35 ? { rate: 5, depth: f * 0.008 } : undefined,
      });
      tone(ctx, dest, { type: 'triangle', freq: f * 2, t, attack: 0.05, hold: len * 0.4, decay: len * 0.4, vol: vol * 0.12 });
      break;
    case 'lute':
      tone(ctx, dest, {
        type: 'sawtooth',
        freq: f,
        t,
        attack: 0.004,
        decay: Math.min(0.7, len + 0.25),
        vol: vol * 0.7,
        filter: { type: 'lowpass', freq: f * 6, freqEnd: f * 1.5, q: 1.5 },
      });
      break;
    case 'horn':
      tone(ctx, dest, {
        type: 'sawtooth',
        freq: f,
        t,
        attack: Math.min(0.12, len * 0.3),
        hold: len * 0.55,
        decay: len * 0.5 + 0.15,
        vol: vol * 0.6,
        filter: { type: 'lowpass', freq: 1100, q: 0.8 },
        vibrato: len > 0.5 ? { rate: 4.5, depth: f * 0.004 } : undefined,
      });
      break;
    case 'oud':
      tone(ctx, dest, {
        type: 'sawtooth',
        freq: f * 1.015,
        freqEnd: f,
        glide: 0.04,
        t,
        attack: 0.003,
        decay: Math.min(0.55, len + 0.18),
        vol: vol * 0.65,
        filter: { type: 'lowpass', freq: f * 5, freqEnd: f * 1.2, q: 3 },
      });
      break;
    case 'bell':
      tone(ctx, dest, { type: 'sine', freq: f, t, attack: 0.003, decay: 0.9, vol });
      tone(ctx, dest, { type: 'sine', freq: f * 2.76, t, attack: 0.002, decay: 0.18, vol: vol * 0.25 });
      break;
    case 'dark':
      tone(ctx, dest, {
        type: 'square',
        freq: f,
        t,
        attack: 0.006,
        decay: Math.min(0.5, len + 0.15),
        vol: vol * 0.45,
        filter: { type: 'lowpass', freq: f * 4, freqEnd: f * 1.3, q: 1 },
      });
      break;
  }
}

function drumKick(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  tone(ctx, dest, { type: 'sine', freq: 120, freqEnd: 45, glide: 0.14, t, attack: 0.003, decay: 0.25, vol });
}

function drumTom(ctx: BaseAudioContext, dest: AudioNode, nb: AudioBuffer, t: number, vol: number, f: number): void {
  tone(ctx, dest, { type: 'sine', freq: f, freqEnd: f * 0.6, glide: 0.2, t, attack: 0.003, decay: 0.28, vol: vol * 0.85 });
  noiseBurst(ctx, dest, nb, { t, decay: 0.04, vol: vol * 0.2, filter: { type: 'lowpass', freq: 1200 } });
}

function drumSnare(ctx: BaseAudioContext, dest: AudioNode, nb: AudioBuffer, t: number, vol: number): void {
  noiseBurst(ctx, dest, nb, { t, decay: 0.12, vol, filter: { type: 'bandpass', freq: 1800, q: 0.9 } });
  tone(ctx, dest, { type: 'triangle', freq: 200, freqEnd: 150, glide: 0.05, t, decay: 0.07, vol: vol * 0.5 });
}

function drumTick(ctx: BaseAudioContext, dest: AudioNode, nb: AudioBuffer, t: number, vol: number): void {
  noiseBurst(ctx, dest, nb, { t, decay: 0.035, vol, filter: { type: 'highpass', freq: 5000, q: 0.7 } });
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export const audio = new Audio();
