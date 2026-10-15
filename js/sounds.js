// 장소 소리를 3D 위치에 놓고 재생한다 (Web Audio HRTF 패너, 논문 sim/audio.js 방식).
// 소리 파일이 없거나 깨져 있으면 합성음으로 대신 재생해서 게임이 멈추지 않게 한다.
class SoundScape {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};      // type -> AudioBuffer (없으면 null)
    this.missing = new Set();
    this.volume = 0.8;
    this.voices = [];       // { pos, lfoDepth, stop() }
    this.timers = [];
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("이 브라우저는 Web Audio를 지원하지 않습니다.");
    this.ctx = new AudioCtx();
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = CONFIG.SOUND_LOWPASS_HZ;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    lowpass.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.input = lowpass;
    return this.ctx;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  async load(type) {
    if (type in this.buffers) return this.buffers[type];
    this.ensureContext();
    try {
      const res = await fetch(SOUND_TYPES[type].file);
      if (!res.ok) throw new Error(res.status);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers[type] = buf;
    } catch (e) {
      this.buffers[type] = null;
      this.missing.add(type);
    }
    return this.buffers[type];
  }

  // 파일이 없을 때 쓰는 합성음 (몇 초짜리 버퍼를 만들어 같은 경로로 재생한다)
  _synthBuffer(type) {
    const sr = this.ctx.sampleRate;
    const dur = SOUND_TYPES[type].mode === "loop" ? 4 : 2;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      if (type === "stadium" || type === "playground") {
        last = last * 0.97 + noise * 0.03; // 낮게 웅성거리는 소리
        d[i] = last * 4 * (0.7 + 0.3 * Math.sin(t * 1.3));
      } else if (type === "fountain") {
        last = last * 0.6 + noise * 0.4;
        d[i] = last * 0.5;
      } else if (type === "construction") {
        const burst = (t % 0.08) < 0.03 && t < 1.2 ? 1 : 0;
        d[i] = noise * 0.6 * burst;
      } else {
        const f = type === "temple" ? 110 : 330;
        d[i] = Math.exp(-t * (type === "temple" ? 1.2 : 2.5)) *
          (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.4 * t)) * 0.5;
      }
    }
    return buf;
  }

  _bufferFor(type) {
    return this.buffers[type] || (this.buffers["_synth_" + type] ||= this._synthBuffer(type));
  }

  _playBuffer(type, dest, loop) {
    const spec = SOUND_TYPES[type];
    const buf = this._bufferFor(type);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = spec.gain;
    if (spec.lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = spec.lowpass;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(dest);
    if (loop) {
      src.loop = true;
      // 합성음 버퍼처럼 짧은 경우에는 구간을 자르지 않는다
      const ls = spec.loopStart && spec.loopStart < buf.duration ? spec.loopStart : 0;
      const le = spec.loopEnd && spec.loopEnd <= buf.duration && spec.loopEnd > ls ? spec.loopEnd : buf.duration;
      src.loopStart = ls;
      src.loopEnd = le;
      src.start(0, ls + Math.random() * (le - ls));
    } else {
      const clip = Math.min(spec.clip || buf.duration, buf.duration);
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(spec.gain, t + Math.max(0, clip - 0.15));
      g.gain.linearRampToValueAtTime(0.0001, t + clip);
      src.start(t, 0, clip);
    }
    return src;
  }

  // 미리 듣기: 공간감 없이 앞에서 2.5초 들려준다
  async preview(type) {
    this.ensureContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await this.load(type);
    const src = this._playBuffer(type, this.input, SOUND_TYPES[type].mode === "loop");
    if (SOUND_TYPES[type].mode === "loop") setTimeout(() => { try { src.stop(); } catch (e) {} }, 2500);
  }

  // landmarks: [{ type, x, z }] (지도 좌표, m)
  async start(landmarks) {
    this.ensureContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await Promise.all(landmarks.map((l) => this.load(l.type)));
    for (const l of landmarks) {
      const spec = SOUND_TYPES[l.type];
      const panner = this.ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "linear";
      panner.refDistance = CONFIG.SOUND_REF_DISTANCE;
      panner.maxDistance = CONFIG.SOUND_MAX_DISTANCE;
      panner.rolloffFactor = CONFIG.SOUND_ROLLOFF;
      // 소리 파일이 스테레오라서, 한 점에서 나는 소리로 들리도록 모노로 합친 뒤 위치를 준다
      panner.channelCount = 1;
      panner.channelCountMode = "explicit";
      const pos = { x: l.x, y: 3, z: l.z };
      if (panner.positionX) { panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z; }
      else panner.setPosition(pos.x, pos.y, pos.z);

      // 가까워질수록 떨리는 효과 (논문 sim/audio.js와 같은 구조)
      const tremolo = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = CONFIG.PROXIMITY_RATE;
      const lfoDepth = this.ctx.createGain();
      lfoDepth.gain.value = 0;
      lfo.connect(lfoDepth);
      lfoDepth.connect(tremolo.gain);
      lfo.start();
      panner.connect(tremolo);
      tremolo.connect(this.input);

      const sources = [];
      if (spec.mode === "loop") {
        sources.push(this._playBuffer(l.type, panner, true));
      } else {
        const fire = () => { if (this.ctx) this._playBuffer(l.type, panner, false); };
        setTimeout(fire, Math.random() * 1500);
        this.timers.push(setInterval(fire, spec.interval));
      }
      this.voices.push({
        pos, lfoDepth,
        stop: () => { sources.forEach((s) => { try { s.stop(); } catch (e) {} }); try { lfo.stop(); } catch (e) {} panner.disconnect(); },
      });
    }
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = camera.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      const d = Math.hypot(p.x - v.pos.x, p.z - v.pos.z);
      const t = Math.max(0, Math.min(1, (CONFIG.PROXIMITY_FAR - d) / (CONFIG.PROXIMITY_FAR - CONFIG.PROXIMITY_NEAR)));
      v.lfoDepth.gain.setTargetAtTime(t * CONFIG.PROXIMITY_DEPTH, now, 0.05);
    }
  }

  stopAll() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.voices.forEach((v) => v.stop());
    this.voices = [];
  }
}

// Web Audio의 linear 감쇠 공식 (테스트 HUD에서 음량을 보여 줄 때 쓴다)
function linearGain(distance) {
  const ref = CONFIG.SOUND_REF_DISTANCE, max = CONFIG.SOUND_MAX_DISTANCE;
  const d = Math.max(ref, Math.min(max, distance));
  return Math.max(0, 1 - (CONFIG.SOUND_ROLLOFF * (d - ref)) / (max - ref));
}
