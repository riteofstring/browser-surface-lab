/** Hover!'s cues, synthesised: the hunters' sonar ping and pickup blips. */
export function createHoverSound() {
  let context: AudioContext | null = null;
  let muted = false;

  const tone = (
    frequency: number,
    end: number,
    duration: number,
    volume: number,
    delay = 0,
  ) => {
    if (!context || muted) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  };

  const cues: Record<string, () => void> = {
    spotted: () => {
      tone(1320, 1180, 0.5, 0.18);
      tone(1320, 1180, 0.45, 0.06, 0.28);
    },
    "flag:blue": () => {
      tone(660, 990, 0.12, 0.12);
      tone(990, 1320, 0.16, 0.12, 0.1);
    },
    "flag:red": () => tone(330, 180, 0.35, 0.12),
    bump: () => tone(140, 90, 0.12, 0.12),
  };

  return {
    /** Audio may only start from a user gesture. */
    unlock() {
      if (context) return;
      const Context = window.AudioContext;
      if (Context) context = new Context();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    play(event: string) {
      const cue =
        cues[event] ??
        (event.startsWith("pod:") ? () => tone(880, 1320, 0.1, 0.08) : null);
      cue?.();
    },
    close() {
      void context?.close();
      context = null;
    },
  };
}
