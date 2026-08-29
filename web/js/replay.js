// Replay: after a session closes, the full event log can be scrubbed.
// Scrubbing re-dispatches events (record=false) from the start up to the
// scrub point — subsystems rebuild state deterministically.

import { getLog, dispatch, subscribe } from './events.js';

const $ = (s) => document.querySelector(s);

export class Replay {
  constructor() {
    this.bar = $('#replaybar');
    this.range = $('#replay-range');
    this.label = $('#replay-label');
    this.playBtn = $('#replay-play');
    this.saved = null;      // frozen copy of the log
    this.playing = false;
    this.playTimer = null;

    subscribe((ev) => {
      if (ev.type === 'session.closed') this.arm();
      if (ev.type === 'session.opened' && !this.isReplaying) this.hide();
    });

    this.range.addEventListener('input', () => this.scrubTo(+this.range.value));
    this.playBtn.addEventListener('click', () => this.togglePlay());
  }

  arm() {
    this.saved = getLog().slice();
    if (!this.saved.length) return;
    this.range.max = this.saved.length - 1;
    this.range.value = this.saved.length - 1;
    this.label.textContent = `replay — ${this.saved.length} events`;
    this.bar.style.display = 'flex';
  }

  hide() {
    this.bar.style.display = 'none';
    this.stop();
  }

  // Re-dispatch events 0..idx instantly (visuals fast-forward).
  scrubTo(idx) {
    if (!this.saved) return;
    this.stop();
    this.isReplaying = true;
    for (let i = 0; i <= idx && i < this.saved.length; i++) {
      dispatch(this.saved[i], { record: false });
    }
    this.isReplaying = false;
    this.range.value = idx;   // keep the handle in step with what is shown
    this.label.textContent = `event ${idx + 1}/${this.saved.length} — ${this.saved[idx]?.type ?? ''}`;
  }

  togglePlay() {
    if (this.playing) { this.stop(); return; }
    if (!this.saved?.length) return;
    // Rewind FIRST: scrubTo() calls stop(), so arming playback before it would
    // immediately clear this.playing and the first step() would bail.
    let i = +this.range.value >= this.saved.length - 1 ? 0 : +this.range.value;
    this.scrubTo(i);
    this.playing = true;
    this.playBtn.textContent = '⏸';
    // Real-time playback honoring original spacing (capped)
    const step = () => {
      if (!this.playing) return;
      i++;
      if (i >= this.saved.length) { this.stop(); return; }
      this.range.value = i;
      this.isReplaying = true;
      dispatch(this.saved[i], { record: false });
      this.isReplaying = false;
      this.label.textContent = `event ${i + 1}/${this.saved.length} — ${this.saved[i].type}`;
      const gap = Math.min(1800, Math.max(200, (this.saved[i + 1]?._t ?? 0) - this.saved[i]._t));
      this.playTimer = setTimeout(step, gap);
    };
    this.playTimer = setTimeout(step, 400);
  }

  stop() {
    this.playing = false;
    this.playBtn.textContent = '▶';
    if (this.playTimer) { clearTimeout(this.playTimer); this.playTimer = null; }
  }
}
