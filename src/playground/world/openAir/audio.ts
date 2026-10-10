export function spatialPan(
  x: number,
  z: number,
  sourceX: number,
  sourceZ: number,
  yaw: number,
): number {
  const dx = sourceX - x,
    dz = sourceZ - z;
  return Math.max(
    -1,
    Math.min(
      1,
      (dx * Math.cos(yaw) - dz * Math.sin(yaw)) /
        Math.max(0.01, Math.hypot(dx, dz)),
    ),
  );
}
/** Procedural positional sound; no network downloads. Only start after a gesture. */
export function createBeachAudio() {
  let context: AudioContext | null = null,
    master: GainNode | null = null;
  let ambient: AudioBufferSourceNode | null = null,
    filter: BiquadFilterNode | null = null,
    gain: GainNode | null = null;
  let volume = 0.35,
    lastStep = 0,
    lastBird = 0,
    lastFountain = 0,
    lastFire = 0;
  function noise(seconds: number) {
    const c = context!;
    const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return b;
  }
  function tone(frequency: number, length: number, level: number, pan = 0) {
    if (!context || !master || context.state !== "running") return;
    const osc = context.createOscillator(),
      g = context.createGain(),
      p = context.createStereoPanner();
    osc.frequency.value = frequency;
    p.pan.value = pan;
    g.gain.setValueAtTime(level, context.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + length);
    osc.connect(g).connect(p).connect(master);
    osc.start();
    osc.stop(context.currentTime + length);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      p.disconnect();
    };
  }
  return {
    start() {
      if (context) {
        void context.resume();
        return;
      }
      try {
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = volume;
        master.connect(context.destination);
        ambient = context.createBufferSource();
        ambient.buffer = noise(3);
        ambient.loop = true;
        filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 650;
        gain = context.createGain();
        gain.gain.value = 0.018;
        ambient.connect(filter).connect(gain).connect(master);
        ambient.start();
      } catch {
        context = null;
      }
    },
    volume(v: number) {
      volume = v;
      if (master) master.gain.value = v;
    },
    update(
      x: number,
      z: number,
      yaw: number,
      moving: boolean,
      wet: boolean,
      stone: boolean,
      wood: boolean,
      now: number,
      wind: number,
    ) {
      if (gain && context)
        gain.gain.setTargetAtTime(
          Math.min(0.1, 0.018 + Math.max(0, -z - 15) * 0.0015 + wind * 0.01),
          context.currentTime,
          0.5,
        );
      if (moving && now - lastStep > 440) {
        lastStep = now;
        tone(
          wet ? 130 : stone ? 260 : wood ? 180 : 90,
          wet ? 0.14 : wood ? 0.12 : 0.07,
          wet ? 0.11 : 0.07,
        );
      }
      if (now - lastFountain > 280) {
        lastFountain = now;
        const d = Math.hypot(x, z);
        if (d < 18)
          tone(
            160 + Math.sin(now / 70) * 30,
            0.24,
            0.03 * (1 - d / 18),
            spatialPan(x, z, 0, 0, yaw),
          );
      }
      if (now - lastFire > 750) {
        lastFire = now;
        const d = Math.hypot(x - 18, z - 18.4);
        if (d < 10)
          tone(
            70 + Math.sin(now) * 20,
            0.035,
            0.04 * (1 - d / 10),
            spatialPan(x, z, 18, 18.4, yaw),
          );
      }
      if (now - lastBird > 13000) {
        lastBird = now;
        tone(1250, 0.16, 0.035, Math.sin(yaw + 0.8));
        tone(1700, 0.22, 0.022, Math.sin(yaw + 0.8));
      }
    },
    landing(surface: "sand" | "stone" | "wood", speed: number) {
      tone(
        surface === "stone" ? 240 : surface === "wood" ? 160 : 85,
        0.1,
        Math.min(0.12, speed * 0.014),
      );
    },
    activity(
      x: number,
      z: number,
      sourceX: number,
      sourceZ: number,
      yaw: number,
      kind: "crab" | "repair",
    ) {
      const distance = Math.hypot(x - sourceX, z - sourceZ);
      if (distance < 8)
        tone(
          kind === "crab" ? 380 : 195,
          0.045,
          0.025 * (1 - distance / 8),
          spatialPan(x, z, sourceX, sourceZ, yaw),
        );
    },
    splash() {
      tone(120, 0.28, 0.16);
    },
    chime() {
      tone(880, 0.45, 0.1);
      tone(1320, 0.6, 0.06);
    },
    dispose() {
      ambient?.stop();
      ambient?.disconnect();
      filter?.disconnect();
      gain?.disconnect();
      master?.disconnect();
      if (context) void context.close();
      context = null;
    },
  };
}
