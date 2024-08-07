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
    this.dynamicVibrato = {
      on: false,
      sustained: false, // whether a command this row kept it on
      // whether to continue offsetting the pitch after vibrato is discontinued
      continuePitchOffset: false,
      type: 0, // see vibratoTypes
      sweep: 0, // ticks between start and full depth
      depth: 0, // 64ths of a semitone variation from original pitch
      rate: 0 // 256ths of a cycle per tick
    };
    this.tremolo = {
      on: false,
      type: 0, // see vibratoTypes
      // no sweep
      depth: 0, // 16ths of full volume?
      rate: 0 // 256ths of a cycle per tick
    };
    // Web Audio API stuff
    this.nextPbr = 1.0; // playback rate at start of next row
    this.targetPbr = 1.0; // target of tone porta, so we stop when we get there
    // TODO stop these if they exist already
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
    this.triggerAutoVibrato(when, true);
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

  // FIXME this might just be a special case of setVolume, WBNI I could just use that instead
  /** Set note volume to 0, but keep the note "playing" in case it is restored
   * by a later command.
   * @param {number} [when=actx.currentTime]
   */
  silenceNote(when) {
    if (when === undefined || when < actx.currentTime) {
      when = actx.currentTime;
    }
    // FIXME magic constant... think this might actually be related to tickDuration, similar to instrument fadeout setting
    // TODO apply this implicit fading to the start of the note too, and maybe any volume change at all
    const fadeoutDuration = 0.005;
    // This should work, but doesn't (in either Firefox or Chrome):
    //this.volumeNode.gain.cancelAndHoldAtTime(when);
    //this.volumeNode.gain.linearRampToValueAtTime(0, when + fadeoutDuration);
    // Firefox doesn't implement cancelAndHoldAtTime at all, and Chrome doesn't
    // do it correctly IMO. And Firefox doesn't correctly implement
    // linearRampToValueAtTime. So instead approximate the effect with
    // setTargetAtTime. Time constant*3 gets us 95% of the way to the target.
    this.volumeNode.gain.cancelScheduledValues(when);
    this.volumeNode.gain.setTargetAtTime(0, when, fadeoutDuration/3);
  }

  /** Stop playing the note (no release phase).
   * @param {number} [when=actx.currentTime]
   */
  cutNote(when) {
    if (this.notePhase == 'off') { return; }
    this.notePhase = 'off';
    this.silenceNote(when);
    this.bs.stop(when + 0.005/*fadeoutDuration FIXME see above*/);
    // these are redundant with silenceNote above, and cause problems with envelopes when using note delay effect (see related FIXME in cutEnvelope)
    //this.cutEnvelope(when, 'volume');
    //this.cutEnvelope(when, 'panning');
    // TODO disconnect/undefine nodes when bs stops
  }

  /** Process a 5-element note/command array from a pattern.
   * @param {number} when
   * @param {number[]} note - 5 elements: note, instrument, volume, effect
   * type, effect parameter
   */
  applyCommand(when, note) {
    const [noteNum, instrumentNum, volume, effectType, effectParam] = note;
    this.dynamicVibrato.sustained = false;
    // TODO if effectParam==0 set it to prev value for some types: 1-7, A, E1-2, EA-B, H (0x11), P, R, X1, X2 (prev value for that type, or any type? what about Exx with part of the type in the param?) (also do this for tooltips)
    this.applyGlobalEffect(when, effectType, effectParam);
    let sampleOffset = 0;
    if (effectType == 0x09) { sampleOffset = effectParam * 0x100; /* bytes */ }
    let triggerDelay = 0, dontTrigger = false;
    if (effectType == 0x0e && (effectParam >> 4) == 0xd) { // delay note
      const delayInTicks = (effectParam & 0xf);
      if (delayInTicks >= this.xm.currentTempo) {
	dontTrigger = true;
      } else {
	triggerDelay = this.xm.tickDuration() * delayInTicks;
      }
    }
    if (dontTrigger) {
      // delay past end of row; don't trigger/release note
    } else if (effectType == 0x03 || effectType == 0x05 ||
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
    if (!dontTrigger) {
      this.applyVolume(when + triggerDelay, volume);
    }
    this.applyEffect(when, effectType, effectParam);
    // if we failed to keep dynamic vibrato on, stop doing it
    if (this.dynamicVibrato.on && !this.dynamicVibrato.sustained) {
      this.discontinueDynamicVibrato(when);
    }
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
      case 0x4: { // vibrato
	const depth = (lo << 3);
	const rate = (hi << 2);
	this.dynamicVibrato.continuePitchOffset = false;
	this.continueOrTriggerDynamicVibrato(when, rate, depth);
	break;
      }
      case 0x5: // porta towards note and volume slide
	this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate,
			this.targetPbr);
	this.volumeSlide(when, up, hiLo);
	break;
      case 0x6: // vibrato and volume slide
	this.dynamicVibrato.continuePitchOffset = false;
	this.continueOrTriggerDynamicVibrato(when, 0, 0);
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
	  // 0x3 glissando control TODO
	  case 0x4: // vibrato type
	    this.dynamicVibrato.type = lo;
	    this.applyVibratoDepthAndType(when);
	    break;
	  // 0x5-0x8 TODO
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
	    if (lo < this.xm.currentTempo) {
	      this.silenceNote(when + this.xm.tickDuration() * lo);
	    }
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
	this.dynamicVibrato.rate = (lo << 2);
	if (this.dynamicVibrato.on) {
	  this.applyVibratoRate(when, this.dynamicVibrato.rate);
	}
	break;
      case 0xb: { // perform vibrato and set depth
        const depth = (lo << 3);
	this.dynamicVibrato.continuePitchOffset = true;
	this.continueOrTriggerDynamicVibrato(when, 0, depth);
	break;
      }
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
      this.volumeNode.gain.setValueAtTime(volumeFraction, when);
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
      this.panningNode.pan.setValueAtTime((panning - 0x80) / 0x80, when);
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
      const targetValue =
        ((which == 'volume') ?
	  (envelope[i][1] / 64) : ((envelope[i][1] - 32) / 32));
      if (targetTime < actx.currentTime) { // lag
	envelopeNode[param].value = targetValue;
      } else {
	envelopeNode[param].linearRampToValueAtTime(targetValue, targetTime);
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
      // FIXME!!! if when!=now (e.g. note delay effect), this can still change the envelope values between now and when, because we were leading up to a scheduled value and now we're not; need to figure out what the value would have been at "when" and reinstate setTargetAtTime (or something?) for that value and time. This conflict with note delay applies to other uses of cancelScheduledValues as well.
      envelopeNode[(which == 'volume') ? 'gain' : 'pan']. // FIXME ugh
	cancelScheduledValues(when);
      if ((which + 'CancelLoop') in this) {
	this[which + 'CancelLoop']();
      }
    }
  }

  /** Make the audio nodes involved in (auto or dynamic) vibrato. */
  makeVibratoNodes() {
    this.vibratoAmplitudeNode = actx.createGain();
    this.vibratoAmplitudeNode.connect(this.bs.detune);
    this.vibratoNode = actx.createOscillator();
    this.vibratoNode.connect(this.vibratoAmplitudeNode);
  }

  /** Make (auto) vibrato depth ramp up after a note is triggered.
   * @param {number} when - start time of sweep
   * @param {number} sweep - duration of sweep in ticks
   * @param {number} gain - gain value at end of sweep
   */
  triggerVibratoSweep(when, sweep, gain) {
    if (sweep != 0) {
      this.vibratoAmplitudeNode.gain.cancelScheduledValues(when);
      // FIXME what if tickDuration changes during sweep?
      const sweepEndTime = when + sweep * this.xm.tickDuration();
      this.vibratoAmplitudeNode.gain.value = 0;
      this.vibratoAmplitudeNode.gain.
	linearRampToValueAtTime(gain, sweepEndTime);
    }
  }

  /** Apply the given depth and type parameters to the current vibrato nodes,
   * if they exist.
   * @param {number} when
   * @param {number} [depth=this.dynamicVibrato.depth] - peak amplitude of
   * vibrato wave (max abs value) in 64ths of a semitone (or peak-to-peak
   * amplitude in 64ths of a whole tone)
   * @param {number} [type=this.dynamicVibrato.type] - 0=sine, 1=saw, 2=square;
   * type|4 means don't retrigger vibrato wave for new notes
   * @return {number} - gain to be passed to triggerVibratoSweep
   */
  applyVibratoDepthAndType(when, depth, type) {
    if (this.vibratoNode === undefined) { return 0; }
    if (depth === undefined) { depth = this.dynamicVibrato.depth; }
    if (type === undefined) { type = this.dynamicVibrato.type; }
    // depth
    // convert 64ths of a semitone to cents
    let gain = depth * 100 / 64;
    if (type & 1) { // ramp/sawtooth down
      gain = -gain;
    }
    this.vibratoAmplitudeNode.gain.setValueAtTime(gain, when);
    // type
    switch (type & 0x3) {
      case 0: this.vibratoNode.type = 'sine'; break;
      case 1: this.vibratoNode.type = 'sawtooth'; break;
      case 2: this.vibratoNode.type = 'square'; break;
      // 4 undefined, ignore
    }
    return gain;
  }

  /* Apply the given rate parameter to the current vibrato nodes, if they
   * exist.
   * @param {number} when
   * @param {number} rate - frequency of vibrato wave in 256ths of a cycle per
   * tick
   */
  applyVibratoRate(when, rate) {
    if (this.vibratoNode === undefined) { return; }
    // convert 256ths of a cycle per tick to Hz
    const freq = rate / (this.xm.tickDuration() * 256);
    this.vibratoNode.frequency.setValueAtTime(freq, when);
  }

  /** Set up nodes and trigger autovibrato (vibrato from instrument settings)
   * if appropriate.
   * @param {number} when
   * @param {boolean} doSweep - true if this is really the start of a note so
   * we should do the vibrato sweep up to full depth if applicable; false if
   * we're just returning to autovibrato from dynamic vibrato on an already
   * playing note
   */
  triggerAutoVibrato(when, doSweep) {
    // make sure we have the appropriate vibrato nodes set up if any
    const oldOn = (this.vibratoNode !== undefined);
    const newOn =
      (this.instrument.vibratoDepth != 0 && this.instrument.vibratoRate != 0);
    const retrigger = !(this.instrument.vibratoType & 4);
    const makeNew = (retrigger || !oldOn);
    if (oldOn && retrigger) { this.cutVibrato(when); }
    if (!newOn) { return; }
    if (makeNew) { this.makeVibratoNodes(); }
    // set parameters of those nodes from instrument
    this.applyVibratoRate(when, this.instrument.vibratoRate);
    const gain = this.applyVibratoDepthAndType(when,
      this.instrument.vibratoDepth, this.instrument.vibratoType);
    if (doSweep) {
      this.triggerVibratoSweep(when, this.instrument.vibratoSweep, gain);
    }
    if (makeNew) { this.vibratoNode.start(when); }
  }

  /** Set up nodes and trigger dynamic vibrato (vibrato from volume/effect
   * column commands).
   * @param {number} when
   */
  triggerDynamicVibrato(when) {
    // make sure we have the appropriate vibrato nodes set up if any
    const oldOn = (this.vibratoNode !== undefined);
    const newDynamicOn =
      (this.dynamicVibrato.depth != 0 && this.dynamicVibrato.rate != 0);
    const newAutoOn =
      (this.instrument.vibratoDepth != 0 && this.instrument.vibratoRate != 0);
    const retrigger = !(this.dynamicVibrato.type & 4);
    const makeNew = (retrigger || !oldOn);
    if (newAutoOn && !newDynamicOn) { return; } // keep doing autovibrato
    if (oldOn && retrigger) { this.cutVibrato(when); }
    if (!newDynamicOn) { return; }
    if (makeNew) { this.makeVibratoNodes(); }
    this.dynamicVibrato.on = true;
    this.dynamicVibrato.sustained = true;
    // set parameters of those nodes from this.dynamicVibrato
    this.applyVibratoRate(when, this.dynamicVibrato.rate);
    this.applyVibratoDepthAndType(when);
    // NOTE: no sweep
    if (makeNew) { this.vibratoNode.start(when); }
  }

  /** Continue currently playing dynamic vibrato, or trigger it if none, and
   * optionally set rate and depth parameters.
   * @param {number} when
   * @param {number} rate - see applyVibratoRate; if 0, use previous value
   * @param {number} depth - see applyVibratoDepthAndType; if 0, use previous
   * value
   */
  continueOrTriggerDynamicVibrato(when, rate, depth) {
    if (rate != 0) {
      this.dynamicVibrato.rate = rate;
    }
    if (depth != 0) {
      this.dynamicVibrato.depth = depth;
    }
    if (this.dynamicVibrato.on) { // continue
      this.dynamicVibrato.sustained = true;
      this.applyVibratoRate(when, this.dynamicVibrato.rate);
      this.applyVibratoDepthAndType(when);
    } else { // trigger
      this.triggerDynamicVibrato(when);
    }
  }

  /** Stop vibrato and tear down nodes.
   * @param {number} when
   */
  cutVibrato(when) {
    this.dynamicVibrato.on = false;
    // work around bug in both FF and Chrome that prevents oscillators with
    // frequency 0 from actually stopping
    this.vibratoNode.frequency.setValueAtTime(when, 5);
    this.vibratoNode.stop(when);
    this.vibratoAmplitudeNode = undefined;
    this.vibratoNode = undefined;
  }

  /** Stop doing dynamic vibrato (assumes we're doing it). May preserve phase
   * and/or pitch offset, depending on vibrato waveform type and the last
   * command used to do dynamic vibrato. Switch back to autovibrato if it's
   * defined.
   * @param {number} when
   */
  discontinueDynamicVibrato(when) {
    this.dynamicVibrato.on = false;
    if (this.dynamicVibrato.continuePitchOffset) {
      this.vibratoNode.frequency.setValueAtTime(when, 0);
    } else if ((this.dynamicVibrato.type & 4)) { // continue wave
      this.vibratoNode.frequency.setValueAtTime(when, 0);
      this.vibratoAmplitudeNode.gain.setValueAtTime(when, 0);
    } else { // retrigger
      this.cutVibrato(when);
    }
    this.triggerAutoVibrato(when, false);
  }

  // TODO apply*Tremolo functions parallel to apply*Vibrato

  /** Set up nodes and trigger (dynamic) tremolo.
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
