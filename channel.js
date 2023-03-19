// webkit prefix stuff required for Safari
if (AudioContext === undefined && webkitAudioContext !== undefined) {
  window.AudioContext = webkitAudioContext;
}
// Safari lacks this
const haveStereoPanner = ('createStereoPanner' in AudioContext.prototype);
// and this
if (!('copyToChannel' in AudioBuffer.prototype)) {
  AudioBuffer.prototype.copyToChannel = function(source, channelNumber) {
    const d = this.getChannelData(channelNumber);
    for (let i = 0; i < source.length; i++) {
      d[i] = source[i];
    }
  };
}

/* exported sampleDataToBufferSource */
function sampleDataToBufferSource(data, bytesPerSample) {
  const bs = actx.createBufferSource();
  const buffer = actx.createBuffer(1, (data.length || 1), 44100);
  const floatData = new Float32Array(data.length);
  // 256 values per byte, minus one bit for sign
  const divisor = Math.pow(256, bytesPerSample) / 2;
  for (let i = 0; i < data.length; i++) {
    floatData[i] = data[i] / divisor;
  }
  buffer.copyToChannel(floatData, 0);
  bs.buffer = buffer;
  return bs;
}

let lastLag = 0;

/**
 * @param {Function} fn
 * @return {Function} a version of fn that will only ever call the original fn
 * once; any subsequent calls to the returned function will do nothing
 */
function once(fn) {
  let first = true;
  return function(...args) {
    if (first) {
      first = false;
      return fn(...args);
    }
  };
}

/* exported afterDelay */
/** Call fn(startTime+delay) at time startTime+delay, or immediately if that
 * has already passed, or if actx is an OfflineAudioContext (which would race).
 * @param {number} startTime
 * @param {number} delay
 * @param {Function} fn
 * @return {Function} a function that can be used to cancel calling fn
 */
function afterDelay(startTime, delay, fn) {
  const endTime = startTime + delay;
  if (actx instanceof OfflineAudioContext) {
    fn(endTime);
    return function() { /* too late */ };
  } else if (actx.currentTime >= endTime) {
    if (actx.currentTime > lastLag + 10) {
      console.warn('lag');
      lastLag = actx.currentTime;
    }
    // Instead of actually calling fn(endTime) immediately, let this function
    // (and its callers) return, and then call fn(endTime). This way we avoid
    // overflowing the stack when we hit a lag spike during an envelope loop.
    // FIXME? does this still happen? does it happen to OfflineAudioContext?
    const tid = setTimeout(function() { fn(endTime); }, 0);
    return function() { clearTimeout(tid); };
  } else {
    const bs = actx.createBufferSource();
    bs.buffer = actx.createBuffer(1,2,22050);
    bs.loop = true;
    // Chrome apparently has a bug where it can call onended multiple times for
    // the same node; once() makes sure fn only gets called the first time
    bs.onended = once(fn.bind(this, endTime));
    bs.connect(actx.destination); // Chrome needs this
    bs.start();
    bs.stop(endTime);
    return function() { bs.onended = undefined; bs.stop(); };
  }
}

/* FIXME: on 2019-11-10 it seems I tested FT2 and thought it wouldn't play
 * notes above noteNum 90, but I just tested with a different file on
 * 2021-01-17 and it did. Something else must be going on. For now I set this
 * back from 90 to 95.
 * OLD NOTE: note numbers can technically go up to 96, but
 * sampleNumberForAllNotes indices only go up to 95, and FT2 will actually only
 * play notes up to 90 (though it will display 96 correctly as B-7). Weird.
 */
const maxNoteNum = 95;

/* exported Channel */
/** One channel/track as it plays notes. */
class Channel {
  constructor(xm) {
    this.xm = xm;
    this.reset();
  }

  /** Reset this channel to the default initial state. */
  reset() {
    // XM stuff
    this.notePhase = 'off'; // 'sustain', 'release'
    this.lastTriggerTime = 0;
    this.noteNum = 0;
    this.instrument = undefined;
    this.sample = undefined;
    this.volume = 0x40; // silent 0x00 - 0x40 full
    this.panning = 0x80; // left 0x00 - 0xff right
    this.portamentoRate = 0; // 16ths of a semitone per tick
    this.vibrato = {
      on: false,
      type: 0, // see vibratoTypes
      sweep: 0, // ticks between start and full depth
      depth: 0, // 16ths of a semitone variation from original pitch
      rate: 0 // 256ths of a cycle per tick
    };
    this.tremolo = {
      on: false,
      type: 0, // see vibratoTypes
      // no sweep
      depth: 0, // 16ths of a semitone variation from original pitch
      rate: 0 // 256ths of a cycle per tick
    };
    // Web Audio API stuff
    this.nextPbr = 1.0; // playback rate at start of next row
    this.targetPbr = 1.0; // target of tone porta, so we stop when we get there
    // TODO stop/disconnect these if they exist already
    this.vibratoNode = undefined; // oscillator
    this.vibratoAmplitudeNode = undefined; // gain
    this.tremoloNode = undefined; // oscillator
    this.tremoloAmplitudeNode = undefined; // gain
    this.volumeNode = undefined; // gain
    this.volumeEnvelopeNode = undefined; // gain w/scheduled changes
    this.panningNode = undefined; // stereo panner
    this.panningEnvelopeNode = undefined; // stereo panner w/scheduled changes
    this.bs = undefined; // BufferSource
  }

  /** Begin playing a note at time "when". If "when" has passed, begin
   * immediately, but schedule things as if "when" were the time the note
   * started. This logic applies to the "when" parameter of all Channel methods.
   * @param {number} when
   * @param {number} noteNum
   * @param {number} instrumentNum
   * @param {number} offsetInBytes
   */
  triggerNote(when, noteNum, instrumentNum, offsetInBytes) {
    // first, stop playing the old note, if any
    if (this.notePhase != 'off') {
      this.cutNote(when);
    }
    this.notePhase = 'sustain';
    this.lastTriggerTime = when;
    this.noteNum = noteNum;
    // get XM resources/settings
    if (instrumentNum > 0 && instrumentNum <= this.xm.instruments.length) {
      this.instrument = this.xm.instruments[instrumentNum-1];
    }
    if (this.instrument === undefined || this.instrument.numberOfSamples == 0) {
      // oh well, let's not trigger a note after all
      this.notePhase = 'off';
      return;
    }
    if ('sampleNumberForAllNotes' in this.instrument) {
      this.sample = this.instrument.samples[
	this.instrument.sampleNumberForAllNotes[noteNum]];
    } else {
      this.sample = this.instrument.samples[0];
    }
    if (this.sample === undefined) {
      // sample lookup somehow still failed; give up on this note
      this.notePhase = 'off';
      return;
    }
    this.nextPbr =
      computePlaybackRate(noteNum, this.sample.relativeNoteNumber,
			  this.sample.finetune);
    this.targetPbr = this.nextPbr;
    const vibratoOn =
      (this.instrument.vibratoDepth != 0 && this.instrument.vibratoRate != 0);
    this.vibrato.type = this.instrument.vibratoType;
    this.vibrato.sweep = this.instrument.vibratoSweep;
    this.vibrato.depth = this.instrument.vibratoDepth;
    this.vibrato.rate = this.instrument.vibratoRate;
    // set up node graph
    this.volumeNode = actx.createGain();
    this.volumeNode.connect(this.xm.masterVolume);
    let downstream = this.volumeNode;
    if ('volumeEnvelope' in this.instrument) {
      this.volumeEnvelopeNode = actx.createGain();
      this.volumeEnvelopeNode.connect(downstream);
      downstream = this.volumeEnvelopeNode;
    }
    if (haveStereoPanner) {
      this.panningNode = actx.createStereoPanner();
      this.panningNode.connect(downstream);
      downstream = this.panningNode;
      if ('panningEnvelope' in this.instrument) {
	this.panningEnvelopeNode = actx.createStereoPanner();
	this.panningEnvelopeNode.connect(downstream);
	downstream = this.panningEnvelopeNode;
      }
    }
    this.bs =
      sampleDataToBufferSource(this.sample.data, this.sample.bytesPerSample);
    if (this.sample.loopType) {
      // TODO ping-pong
      this.bs.loop = true;
      this.bs.loopStart =
	this.sample.loopStart /
	this.sample.bytesPerSample /
	44100;
      this.bs.loopEnd =
	(this.sample.loopStart + this.sample.loopLength) /
	this.sample.bytesPerSample /
	44100;
    }
    this.bs.connect(downstream);
    // NOTE: Vibrato nodes are created in triggerVibrato since that can happen
    // at other times too, and tremolo nodes are created/destroyed in
    // triggerTremolo.
    // apply settings to nodes
    this.bs.playbackRate.value = this.nextPbr;
    this.setVolume(when, this.sample.volume);
    this.setPanning(when, this.sample.panning);
    // trigger everything
    if ('volumeEnvelope' in this.instrument) { this.triggerEnvelope(when, 'volume'); }
    if ('panningEnvelope' in this.instrument){ this.triggerEnvelope(when, 'panning'); }
    if (vibratoOn) { this.triggerVibrato(when); }
    // trigger sample
    if (offsetInBytes != 0) {
      const offsetInSamples = offsetInBytes / this.sample.bytesPerSample;
      const offsetInSeconds = offsetInSamples / 44100;
      this.bs.start(when, offsetInSeconds);
    } else {
      this.bs.start(when);
    }
  }

  /** End the sustain phase of playing the note and enter the release phase.
   * @param {number} [when=actx.currentTime]
   */
  releaseNote(when) {
    if (this.notePhase != 'sustain') { return; }
    if (when === undefined) { when = actx.currentTime; }
    this.notePhase = 'release';
    // FIXME is this actually the correct condition? what if the sample doesn't loop?
    if (this.instrument.volumeFadeout > 0 ||
	'volumeEnvelope' in this.instrument) {
      this.setVolume(when, this.volume); // start fadeout if necessary
      this.releaseEnvelope(when, 'volume');
      this.releaseEnvelope(when, 'panning');
    } else { // no fadeout, no volume envelope
      // just cut the note so it doesn't go on forever
      this.cutNote(when);
    }
  }

  /** Stop playing the note (no release phase).
   * @param {number} [when=actx.currentTime]
   */
  cutNote(when) {
    if (this.notePhase == 'off') { return; }
    this.notePhase = 'off';
    if (when === undefined || when < actx.currentTime) {
      when = actx.currentTime;
    }
    // avoid clicks at note ends
    this.volumeNode.gain.cancelScheduledValues(when);
    // FIXME magic constants not specified anywhere in the XM spec
    this.volumeNode.gain.setTargetAtTime(0, when, 0.1);
    this.bs.stop(when+0.2);
    this.cutEnvelope(when, 'volume');
    this.cutEnvelope(when, 'panning');
    // TODO disconnect/undefine nodes when when+0.2 passes
  }

  /** Process a 5-element note/command array from a pattern.
   * @param {number} when
   * @param {number[]} note - 5 elements: note, instrument, volume, effect
   * type, effect parameter
   */
  applyCommand(when, note) {
    const [noteNum, instrumentNum, volume, effectType, effectParam] = note;
    // TODO if effectParam==0 set it to prev value for some types: 1-7, A, E1-2, EA-B, H (0x11), P, R, X1, X2 (prev value for that type, or any type? what about Exx with part of the type in the param?) (also do this for tooltips)
    this.applyGlobalEffect(when, effectType, effectParam);
    let sampleOffset = 0;
    if (effectType == 0x09) { sampleOffset = effectParam * 0x100; /* bytes */ }
    let triggerDelay = 0;
    if (effectType == 0x0e && (effectParam >> 4) == 0xd) { // delay note
      triggerDelay = this.xm.tickDuration() * (effectParam & 0xf);
    }
    if (effectType == 0x03 || effectType == 0x05 ||
	(volume & 0xf0) == 0xf0) {
      // portamento to note, don't trigger a new note
      if (noteNum > 0 && noteNum <= maxNoteNum && this.notePhase != 'off') {
	this.targetPbr =
	  computePlaybackRate(noteNum, this.sample.relativeNoteNumber,
			      this.sample.finetune);
	this.setVolume(when, this.sample.volume);
	// FIXME!!! this is an attempted solution to extended 3xx portamento not playing with a short envelope... it's almost right, but still sounds off, and occasionally still drops notes
	if ('volumeEnvelope' in this.instrument) {
	  this.retriggerEnvelope(when, 'volume');
	}
	if ('panningEnvelope' in this.instrument) {
	  this.retriggerEnvelope(when, 'panning');
	}
      }
    } else if (effectType == 0x0e && (effectParam >> 4) == 0xe) {
      // delay pattern
      // TODO
    } else if (noteNum == 97) {
      this.releaseNote(when + triggerDelay);
    } else if (noteNum > 0 && noteNum <= maxNoteNum) {
      this.triggerNote(when + triggerDelay, noteNum,
		       instrumentNum, sampleOffset);
    }
    this.applyVolume(when, volume);
    this.applyEffect(when, effectType, effectParam);
  }

  /** Apply a global effect.
   * @param {number} when
   * @param {number} effectType
   * @param {number} effectParam
   */
  applyGlobalEffect(when, effectType, effectParam) {
    switch (effectType) {
      case 0xf: // set tempo/BPM
	if (effectParam == 0) {
	  stopPlaying(); // FIXME kind of icky to call back into xm-player.js from here
	} else if (effectParam < 0x20) {
	  this.xm.currentTempo = effectParam;
	} else {
	  this.xm.currentBPM = effectParam;
	}
	break;
      case 0x10: // set global volume
	this.xm.setVolume(when, effectParam);
	break;
      case 0x11: { // global volume slide
	const hi = (effectParam >> 4);
	const lo = (effectParam & 0xf);
	const up = (hi ? true : false);
	const hiLo = (up ? hi : lo);
	this.xm.volumeSlide(when, up, hiLo);
	break;
      }
      default:
	/* TODO apply other global effects? */
    }
  }

  /** Process the effect/param portion of a note.
   * @param {number} when
   * @param {number} effectType
   * @param {number} effectParam
   */
  applyEffect(when, effectType, effectParam) {
    // NOTE: this.bs.playbackRate.value might be wrong in the context of the
    // song; we always set this.nextPbr to the value it *should* be at the start
    // of the next row
    const oldPbr = this.nextPbr;
    const hi = (effectParam >> 4);
    const lo = (effectParam & 0xf);
    const up = (hi ? true : false);
    const hiLo = (up ? hi : lo);
    switch (effectType) {
      case 0x0: // arpeggio
	// theoretically it would be OK if we did this even with effectParam==0,
	// but Firefox doesn't like it for some reason (interferes with porta),
	// and anyway it's less efficient
	if (effectParam != 0) {
	  // three notes: the current note, the high nibble of the parameter
	  // semitones up from that, and the low nibble up from the current note
	  const secondNote = (effectParam >> 4);
	  const thirdNote = (effectParam & 0xf);
	  const pbrs = [
	    oldPbr,
	    oldPbr * Math.pow(2, secondNote / 12),
	    oldPbr * Math.pow(2, thirdNote / 12)
	  ];
	  // rotate through pbrs for each tick in this row
	  let i, t;
	  for (i = 0, t = when;
	       i < this.xm.currentTempo; // ticks per row
	       i++, t += this.xm.tickDuration()) {
	    this.bs.playbackRate.setValueAtTime(pbrs[i%3], t);
	  }
	  // set back to oldPbr after row finishes
	  this.bs.playbackRate.setValueAtTime(oldPbr, t);
	}
	break;
      case 0x1: // porta up effectParam 16ths of a semitone per tick
      case 0x2: // porta down
	this.portamento(when, (effectType == 0x1), effectParam);
	break;
      case 0x3: // porta towards note
	if (effectParam > 0) { this.portamentoRate = effectParam; }
	this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate,
			this.targetPbr);
	break;
      case 0x4: // vibrato
	// note: these triggerVibrato automatically if appropriate
	if (lo > 0) { this.setVibratoTremolo(when, 'vibrato', 'depth', lo); }
	if (hi > 0) { this.setVibratoTremolo(when, 'vibrato', 'rate', (hi << 2));}
	break;
      case 0x5: // porta towards note and volume slide
	this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate,
			this.targetPbr);
	this.volumeSlide(when, up, hiLo);
	break;
      case 0x6: // vibrato and volume slide
	this.triggerVibrato(when);
	this.volumeSlide(when, up, hiLo);
	break;
      case 0x7: break; // TODO tremolo
      case 0x8: // set panning
	this.setPanning(when, effectParam);
	break;
      // case 0x9: break; sample offset see applyCommand
      case 0xa: // volume slide
	this.volumeSlide(when, up, hiLo);
	break;
      case 0xb: // jump to song position
	this.xm.nextSongPosition = effectParam;
	break;
      case 0xc: // set volume
	this.setVolume(when, effectParam);
	break;
      case 0xd: // jump to row in next pattern
	// bizarrely this is encoded so that in hexadecimal it looks like a
	// decimal value, which is the real row number (binary-coded decimal)
	this.xm.nextPatternStartRow = hi * 10 + lo;
	this.xm.nextSongPosition = this.xm.currentSongPosition + 1;
	break;
      case 0xe: // extended effects
	switch (hi) {
	  case 0x1: // fine porta up
	  case 0x2: // fine porta down
	    this.portamento(when, (hi == 0x1), lo / this.xm.currentTempo);
	    break;
	  // 0x3-0x8 TODO
	  case 0x9: { // re-trigger note
	    // NOTE: this only handles *re*-triggering the note; if you just
	    // have this effect on a row without a note, the already-playing
	    // note won't retrigger on the first tick of that row, only on
	    // subsequent re-triggering ticks
	    // lo is the period in ticks between note triggers
	    const td = this.xm.tickDuration();
	    for (let tick = lo; tick < this.xm.currentTempo; tick += lo) {
	      const reWhen = when + tick * td;
	      // NOTE: instrument==0 preserves current instrument setting
	      this.triggerNote(reWhen, this.noteNum, 0, 0);
	    }
	    break;
	  }
	  case 0xa: // fine volume slide up
	  case 0xb: // fine volume slide down
	    this.volumeSlide(when, (hi == 0xa), lo / this.xm.currentTempo);
	    break;
	  case 0xc: // note cut
	    // FIXME actually, this just "sets the note volume to 0"; the note
	    // may be resurrected on a following row (see jumping.xm pattern 3,
	    // rows 0x0e-0x1b)
	    this.cutNote(when + this.xm.tickDuration() * lo);
	    break;
	  case 0xd: break; // delay note (see applyCommand)
	  case 0xe: break; // delay pattern (see applyCommand)
	  default:
	    // TODO
	}
	break;
      // 0xf-0x11 see applyGlobalEffect
      case 0x14: // release note
	this.releaseNote(when + this.xm.tickDuration() * effectParam);
	break;
      case 0x15: break; // TODO volume envelope jump
      case 0x19: break; // TODO panning slide
      case 0x1b: break; // TODO retrigger with volume slide
      case 0x1d: break; // TODO tremor
      case 0x21: // extra fine portamento
	switch (hi) {
	  case 0x1: // fine porta up
	  case 0x2: // fine porta down
	    this.portamento(when, (hi == 0x1),
			    lo / (0x40 * this.xm.currentTempo));
	    break;
	 }
	 break;
      default:
	/* TODO apply other channel effects */
    }
  }

  /** Process the volume column of a note.
   * @param {number} when
   * @param {number} volume
   */
  applyVolume(when, volume) {
    const oldPbr = this.nextPbr;
    const hi = (volume >> 4);
    const lo = (volume & 0xf);
    switch (hi) {
      case 0x0:
	// do nothing
	break;
      case 0x1:
      case 0x2:
      case 0x3:
      case 0x4:
      case 0x5:
	this.setVolume(when, volume - 0x10);
	break;
      case 0x6: // volume slide down
      case 0x7: // volume slide up
	this.volumeSlide(when, (hi == 0x7), lo);
	break;
      case 0x8: // fine volume slide down
      case 0x9: // fine volume slide up
	this.volumeSlide(when, (hi == 0x9), lo / this.xm.currentTempo);
	break;
      case 0xa: // set vibrato speed
	this.setVibratoTremolo(when, 'vibrato', 'rate', (lo << 2), true);
	break;
      case 0xb: // perform vibrato and set depth
	this.setVibratoTremolo(when, 'vibrato', 'depth', lo);
	break;
      case 0xc: // set panning
	this.setPanning(when, (lo << 4));
	break;
      case 0xd: // panning slide left
      case 0xe: // panning slide right
	// TODO
	break;
      case 0xf: // portamento towards note
	if (lo > 0) { this.portamentoRate = (lo << 4); }
	this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate,
			this.targetPbr);
	break;
    }
  }

  portamento(when, up, rate, stopAtPbr) {
    const oldPbr = this.nextPbr;
    const pbrFactor = this.xm.portaToPlaybackRateFactor(rate);
    let newPbr = (up ? (oldPbr * pbrFactor) : (oldPbr / pbrFactor));
    let durationFactor = 1;
    if (stopAtPbr !== undefined &&
	(up ? (newPbr > stopAtPbr) : (newPbr < stopAtPbr))) {
      const currentPbrFactor = newPbr / oldPbr; // includes effect of up
      const targetPbrFactor = stopAtPbr / oldPbr;
      durationFactor = Math.log(targetPbrFactor) / Math.log(currentPbrFactor);
      newPbr = stopAtPbr;
    }
    const rowEndTime = when + (this.xm.rowDuration() * durationFactor);
    if (this.bs !== undefined) {
      // make sure it's exactly oldPbr at "when", in case it's in the future
      this.bs.playbackRate.setValueAtTime(oldPbr, when);
      this.bs.playbackRate.exponentialRampToValueAtTime(newPbr, rowEndTime);
    }
    this.nextPbr = newPbr;
  }

  getFadeoutVolume(when, unfadedVolume) {
    if (this.notePhase != 'release' || this.instrument.volumeFadeout == 0) {
      return unfadedVolume;
    } else {
      // FIXME what if BPM changes?
      return unfadedVolume *
	(1 - (this.xm.tickDuration() * this.instrument.volumeFadeout / 0x8000));
    }
  }

  /** Set the actual note volume 0-0x40 (not the volume column, not the
   * envelope).
   * @param {number} [when=actx.currentTime]
   * @param {number} volume
   */
  setVolume(when, volume) {
    if (when === undefined) { when = actx.currentTime; }
    this.volume = volume;
    if (this.notePhase != 'off') {
      const volumeFraction = this.getFadeoutVolume(when, volume / 0x40);
      if (when > actx.currentTime) {
	this.volumeNode.gain.setValueAtTime(volumeFraction, when);
      } else {
	this.volumeNode.gain.value = volumeFraction;
      }
      if (this.notePhase == 'release' && this.instrument.volumeFadeout != 0) {
	// FIXME what if BPM changes?
	const fadeoutEndTime = // time when volume reaches 0
	  when +
	  volumeFraction * this.xm.tickDuration() * 0x8000 /
	  this.instrument.volumeFadeout;
	this.volumeNode.gain.linearRampToValueAtTime(0, fadeoutEndTime);
      }
    }
  }

  /** Slide volume.
   * @param {number} when
   * @param {boolean} up - if true, slide up, else slide down
   * @param {number} rate - rate of slide in 64ths of full volume per tick
   */
  volumeSlide(when, up, rate) {
    // FIXME how does this interact with instrument volume fadeout?
    const duration = this.xm.rowDuration();
    const oldVolume = this.volume;
    let newVolume = oldVolume + (up ? 1 : -1) * rate * this.xm.currentTempo;
    // clamp 0-0x40
    if (newVolume < 0) {
      newVolume = 0;
    } else if (newVolume > 0x40) {
      newVolume = 0x40;
    }
    this.volume = newVolume; // for next row
    if (this.notePhase != 'off') {
      // make sure it's exactly oldVolume at "when", in case it's in the future
      this.volumeNode.gain.setValueAtTime(oldVolume / 0x40, when);
      this.volumeNode.gain.linearRampToValueAtTime(
	  newVolume / 0x40, when + duration);
    }
  }

  /** Set the note panning (not the envelope).
   * @param {number} when
   * @param {number} panning
   */
  setPanning(when, panning) {
    this.panning = panning;
    if (this.notePhase != 'off' && haveStereoPanner) {
      if (when > actx.currentTime) {
	this.panningNode.pan.setValueAtTime((panning - 0x80) / 0x80, when);
      } else {
	this.panningNode.pan.value = (panning - 0x80) / 0x80;
      }
    }
  }

  /** Set a vibrato or tremolo (depending on "which") parameter (depending on
   * "key") to "val". Automatically set this[which].on based on the new
   * settings.
   * Keys and vals are in terms of autovibrato, though this is used for dynamic
   * vibrato; pay attention to units and the options for "type".
   * @param {number} when
   * @param {string} which - 'vibrato' or 'tremolo'
   * @param {string} key - one of 'on', 'type', 'sweep', 'depth', or 'rate'
   * @param {boolean|number} val
   * @param {boolean} dontTrigger
   */
  setVibratoTremolo(when, which, key, val, dontTrigger) {
    this[which][key] = val;
    if (this[which].on) { // already on
      if (this[which].depth != 0 && this[which].rate != 0) { // and staying on
	// adjust AudioParams
	// TODO factor this out and reuse in trigger{Vibrato|Tremolo}
	switch (key) {
	  case 'depth':
	    switch (which) {
	      case 'vibrato': {
		// convert 16ths of a semitone to cents
		let gain = val * 100 / 16;
		if (this.vibrato.type == 4) { // saw down
		  gain = -gain;
		}
		this.vibratoAmplitudeNode.gain.value = gain;
		break;
	      }
	      case 'tremolo':
		// TODO
		break;
	    }
	    break;
	  case 'rate': {
	    // convert 256ths of a cycle per tick to Hz
	    const freq = this.vibrato.rate / (this.xm.tickDuration() * 256);
	    this.vibratoNode.frequency.value = freq;
	    break;
	  }
	  case 'type':
	    // TODO
	    break;
	}
      } else { // new setting turns it off
	this['cut' + which.slice(0,1).toUpperCase() + which.slice(1)](when);
      }
    } else { // currently off
      if ((!dontTrigger) &&
	  this[which].depth != 0 && this[which].rate != 0) { // but turning on
	this['trigger' + which.slice(0,1).toUpperCase() + which.slice(1)](when);
      } // else staying off
    }
  }

  /** Begin volume/panning envelope (depending on "which").
   * @param {number} when
   * @param {string} which - 'volume' or 'panning'
   * @param {number} [firstPoint=0] - index of the envelope point to start at
   */
  triggerEnvelope(when, which, firstPoint) {
    if (when < 0) { throw "WTF"; }
    if (firstPoint === undefined) { firstPoint = 0; }
    const envelope = this.instrument[which + 'Envelope'];
    const envelopeNode = this[which + 'EnvelopeNode'];
    const param = (which == 'volume') ? 'gain' : 'pan';
    for (let i = firstPoint; i < envelope.length; i++) {
      // FIXME what if BPM changes? should we only be scheduling the envelope a row at a time?
      const delay = envelope[i][0] * this.xm.tickDuration();
      const targetTime = when + delay;
      if (targetTime >= actx.currentTime) {
	envelopeNode[param].linearRampToValueAtTime(
	  ((which == 'volume') ?
	    (envelope[i][1] / 64) : ((envelope[i][1] - 32) / 32)),
	  targetTime
	);
      }
      if (this.notePhase == 'sustain' &&
	  ((which + 'SustainPoint') in this.instrument) &&
	  i == this.instrument[which + 'SustainPoint']) {
	break;
      }
      if (((which + 'LoopEndPoint') in this.instrument) &&
	  i == this.instrument[which + 'LoopEndPoint']) {
	this[which + 'CancelLoop'] =
	  afterDelay(when, delay,
	    this.loopEnvelope.bind(this, targetTime, which));
      }
    }
  }

  /** Restart volume/panning envelope on already playing note.
   * @param {number} when
   * @param {string} which - 'volume' or 'panning'
   */
  retriggerEnvelope(when, which) {
    this.cutEnvelope(when, which);
    this.triggerEnvelope(when, which);
  }

  /** Sustain volume/panning envelope by looping back to the loop start
   * position.
   * @param {number} when
   * @param {string} which - 'volume' or 'panning'
   */
  loopEnvelope(when, which) {
    if (when < 0) { throw "WTF"; }
    const loopStartPoint = this.instrument[which + 'LoopStartPoint'];
    const timeUntilLoopStart =
      this.instrument[which + 'Envelope'][loopStartPoint][0] *
      this.xm.tickDuration(); // FIXME what if BPM changes?
    this.triggerEnvelope(when - timeUntilLoopStart, which, loopStartPoint);
  }

  /** End the sustain phase of volume/panning envelope and enter the release
   * phase.
   * @param {number} when
   * @param {string} which - 'volume' or 'panning'
   */
  releaseEnvelope(when, which) {
    const envelopeNode = this[which + 'EnvelopeNode'];
    if (envelopeNode !== undefined) {
      // schedule post-sustain part
      // TODO check if loop is (uselessly) entirely before sustain?
      if ((which + 'SustainPoint') in this.instrument) {
	const sustainPoint = this.instrument[which + 'SustainPoint'];
	const timeUntilSustain =
	  this.instrument[which + 'Envelope'][sustainPoint][0] *
	  this.xm.tickDuration(); // FIXME what if BPM changes?
	const sustainTime = this.lastTriggerTime + timeUntilSustain;
	if (when > sustainTime) {
	  this.triggerEnvelope(when - timeUntilSustain, which, sustainPoint);
	} else {
	  this.triggerEnvelope(this.lastTriggerTime, which, sustainPoint);
	}
      }
    }
  }

  /** Stop using volume/panning envelope (no release phase).
   * @param {number} when
   * @param {string} which - 'volume' or 'panning'
   */
  cutEnvelope(when, which) {
    const envelopeNode = this[which + 'EnvelopeNode'];
    if (envelopeNode !== undefined) {
      envelopeNode[(which == 'volume') ? 'gain' : 'pan']. // FIXME ugh
	cancelScheduledValues(when);
      if ((which + 'CancelLoop') in this) {
	this[which + 'CancelLoop']();
      }
    }
  }

  /** Set up nodes and trigger vibrato.
   * @param {number} when
   */
  triggerVibrato(when) {
    // get rid of previous vibrato
    if (this.vibrato.on) { this.cutVibrato(when); }
    this.vibrato.on = true;
    this.vibratoAmplitudeNode = actx.createGain();
    this.vibratoAmplitudeNode.connect(this.bs.detune);
    let gain = this.vibrato.depth * 16 / 100; // cents
    this.vibratoNode = actx.createOscillator();
    this.vibratoNode.connect(this.vibratoAmplitudeNode);
    // convert 256ths of a cycle per tick to Hz
    const freq = this.vibrato.rate / (this.xm.tickDuration() * 256);
    this.vibratoNode.frequency.value = freq;
    switch (this.vibrato.type) {
      case 0:
	this.vibratoNode.type = "sine";
	break;
      case 1:
	this.vibratoNode.type = "square";
	break;
      case 3: // saw down (negative saw up)
	gain = -gain;
	// fall through
      case 2: // saw up
	this.vibratoNode.type = "sawtooth";
	break;
      default:
	console.warn('bogus vibrato type ' + this.vibrato.type);
    }
    if (this.vibrato.sweep == 0) {
      this.vibratoAmplitudeNode.gain.value = gain;
    } else {
      const sweepEndTime = when + this.vibrato.sweep * this.xm.tickDuration();
      this.vibratoAmplitudeNode.gain.value = 0;
      this.vibratoAmplitudeNode.gain.
	linearRampToValueAtTime(gain, sweepEndTime);
    }
    this.vibratoNode.start(when);
  }

  /** Stop vibrato and tear down nodes.
   * @param {number} when
   */
  cutVibrato(when) {
    this.vibrato.on = false;
    this.vibratoNode.stop(when);
    this.vibratoAmplitudeNode.disconnect();
    this.vibratoNode.disconnect();
    this.vibratoAmplitudeNode = undefined;
    this.vibratoNode = undefined;
  }

  /** Set up nodes and trigger tremolo.
   * @param {number} when
   */
  triggerTremolo(when) {
    // TODO like vibrato but with volume instead of detune (may need extra volume node?)
  }

  /** Stop tremolo and tear down nodes.
   * @param {number} when
   */
  cutTremolo(when) {
    // TODO
  }
}
