// webkit prefix stuff required for Safari
if (AudioContext === undefined && webkitAudioContext !== undefined) {
  var AudioContext = webkitAudioContext;
}
// Safari lacks this
var haveStereoPanner = ('createStereoPanner' in AudioContext.prototype);
// and this
if (!('copyToChannel' in AudioBuffer.prototype)) {
  AudioBuffer.prototype.copyToChannel = function(source, channelNumber) {
    var d = this.getChannelData(channelNumber);
    for (var i = 0; i < source.length; i++) {
      d[i] = source[i];
    }
  }
}

function sampleDataToBufferSource(data, bytesPerSample) {
  var bs = actx.createBufferSource();
  var buffer = actx.createBuffer(1, (data.length || 1), 44100);
  var floatData = new Float32Array(data.length);
  // 256 values per byte, minus one bit for sign
  var divisor = Math.pow(256, bytesPerSample) / 2;
  for (var i = 0; i < data.length; i++) {
    floatData[i] = data[i] / divisor;
  }
  buffer.copyToChannel(floatData, 0);
  bs.buffer = buffer;
  return bs;
}

var lastLag = 0;

// call fn(startTime+delay) at time startTime+delay, or immediately if that has
// already passed. Return a function that can be used to cancel calling fn.
function afterDelay(startTime, delay, fn) {
  var endTime = startTime + delay;
  if (actx.currentTime >= endTime) {
    if (actx.currentTime > lastLag + 10) {
      console.log('WARNING: lag');
      lastLag = actx.currentTime;
    }
    fn(endTime);
    return function() {};
  } else {
    var bs = actx.createBufferSource();
    bs.buffer = actx.createBuffer(1,2,22050);
    bs.loop = true;
    bs.onended = fn.bind(this, endTime);
    bs.connect(actx.destination); // Chrome needs this
    bs.start();
    bs.stop(endTime);
    return function() { bs.onended = undefined; bs.stop(); };
  }
}

/* One channel/track as it plays notes. */
function Channel(xm) {
  this.xm = xm;
  this.reset();
}

[ // begin Channel methods

function reset() {
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
},

/* Begin playing a note at time "when". If "when" has passed, begin
 * immediately, but schedule things as if "when" were the time the note
 * started. This logic applies to the "when" parameter of all Channel methods.
 */
function triggerNote(when, noteNum, instrumentNum, offsetInBytes) {
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
    this.sample = this.instrument.samples[this.instrument.sampleNumberForAllNotes[noteNum]];
  } else {
    this.sample = this.instrument.samples[0];
  }
  this.nextPbr =
    computePlaybackRate(noteNum, this.sample.relativeNoteNumber, this.sample.finetune);
  this.targetPbr = this.nextPbr;
  var vibratoOn = (this.instrument.vibratoDepth != 0 && this.instrument.vibratoRate != 0);
  this.vibrato.type = this.instrument.vibratoType;
  this.vibrato.sweep = this.instrument.vibratoSweep;
  this.vibrato.depth = this.instrument.vibratoDepth;
  this.vibrato.rate = this.instrument.vibratoRate;
  // set up node graph
  this.volumeNode = actx.createGain();
  this.volumeNode.connect(this.xm.masterVolume);
  var downstream = this.volumeNode;
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
  this.bs = sampleDataToBufferSource(this.sample.data, this.sample.bytesPerSample);
  if (this.sample.loopType) {
    // TODO ping-pong
    this.bs.loop = true;
    this.bs.loopStart = this.sample.loopStart / this.sample.bytesPerSample / 44100;
    this.bs.loopEnd = (this.sample.loopStart + this.sample.loopLength) / this.sample.bytesPerSample / 44100;
  }
  this.bs.connect(downstream);
  // NOTE: Vibrato nodes are created in triggerVibrato since that can happen at
  // other times too, and tremolo nodes are created/destroyed in triggerTremolo.
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
    var offsetInSamples = offsetInBytes / this.sample.bytesPerSample;
    var offsetInSeconds = offsetInSamples / 44100;
    this.bs.start(when, offsetInSeconds);
  } else {
    this.bs.start(when);
  }
},

/* End the sustain phase of playing the note and enter the release phase. */
function releaseNote(when) {
  if (this.notePhase != 'sustain') { return; }
  if (when === undefined) { when = actx.currentTime; }
  this.notePhase = 'release';
  // FIXME is this actually the correct condition? what if the sample doesn't loop?
  if (this.instrument.volumeFadeout > 0 ||
      'volumeEnvelope' in this.instrument) {
    this.setVolume(when, this.volume); // start fadeout if necessary
    this.releaseEnvelope(when, 'volume');
    this.releaseEnvelope(when, 'panning');
  } else { // no fadeout, no volume envelope, just cut the note so it doesn't go on forever
    this.cutNote(when);
  }
},

/* Stop playing the note (no release phase). */
function cutNote(when) {
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
},

/* Process a 5-element note/command array from a pattern. */
function applyCommand(when, note) {
  var noteNum = note[0];
  var instrumentNum = note[1];
  var volume = note[2];
  var effectType = note[3];
  var effectParam = note[4];
  this.applyGlobalEffect(when, effectType, effectParam);
  var sampleOffset = 0;
  if (effectType == 0x09) { sampleOffset = effectParam * 0x100; /* bytes */ }
  var triggerDelay = 0;
  if (effectType == 0x0e && (effectParam >> 4) == 0xd) { // delay note
    triggerDelay = this.xm.tickDuration() * (effectParam & 0xf);
  }
  if (effectType == 0x03 || effectType == 0x05 ||
      (volume & 0xf0) == 0xf0) {
    // portamento to note, don't trigger a new note
    if (noteNum > 0 && noteNum < 97 && this.notePhase != 'off') {
      this.targetPbr =
	computePlaybackRate(noteNum, this.sample.relativeNoteNumber, this.sample.finetune);
      this.setVolume(when, this.sample.volume);
    }
  } else if (effectType == 0x0e && (effectParam >> 4) == 0xe) {
    // delay pattern
    // TODO
  } else if (noteNum == 97) {
    this.releaseNote(when + triggerDelay);
  } else if (noteNum > 0 && noteNum < 97) {
    this.triggerNote(when + triggerDelay, noteNum, instrumentNum, sampleOffset);
  }
  this.applyVolume(when, volume);
  this.applyEffect(when, effectType, effectParam);
},

function applyGlobalEffect(when, effectType, effectParam) {
  switch (effectType) {
    case 0xf: // set tempo/BPM
      if (effectParam < 0x20) {
	this.xm.currentTempo = effectParam;
      } else {
	this.xm.currentBPM = effectParam;
      }
      break;
    case 0x10: // set global volume
      this.xm.setVolume(when, effectParam);
      break;
    case 0x11: // global volume slide
      var hi = (effectParam >> 4);
      var lo = (effectParam & 0xf);
      var upDown = (hi ? true : false);
      var hiLo = (upDown ? hi : lo);
      this.xm.volumeSlide(when, upDown, hiLo);
      break;
    default:
      /* TODO apply other global effects? */
  }
},

/* Process the effect/param portion of a note. */
function applyEffect(when, effectType, effectParam) {
  // NOTE: this.bs.playbackRate.value might be wrong in the context of the
  // song; we always set this.nextPbr to the value it *should* be at the start
  // of the next row
  var oldPbr = this.nextPbr;
  var hi = (effectParam >> 4);
  var lo = (effectParam & 0xf);
  var upDown = (hi ? true : false);
  var hiLo = (upDown ? hi : lo);
  switch (effectType) {
    case 0x0: // arpeggio
      // theoretically it would be OK if we did this even with effectParam==0,
      // but Firefox doesn't like it for some reason (interferes with porta),
      // and anyway it's less efficient
      if (effectParam != 0) {
	// three notes: the current note, the high nibble of the parameter
	// semitones up from that, and the low nibble up from the current note
	var secondNote = (effectParam >> 4);
	var thirdNote = (effectParam & 0xf);
	var pbrs = [
	  oldPbr,
	  oldPbr * Math.pow(2, secondNote / 12),
	  oldPbr * Math.pow(2, thirdNote / 12)
	];
	// rotate through pbrs for each tick in this row
	for (var i = 0, t = when;
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
      this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate, this.targetPbr);
      break;
    case 0x4: // vibrato
      // note: these triggerVibrato automatically if appropriate
      if (lo > 0) { this.setVibratoTremolo(when, 'vibrato', 'depth', lo); }
      if (hi > 0) { this.setVibratoTremolo(when, 'vibrato', 'rate', (hi << 2));}
      break;
    case 0x5: // porta towards note and volume slide
      this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate, this.targetPbr);
      this.volumeSlide(when, upDown, hiLo);
      break;
    case 0x6: // vibrato and volume slide
      this.triggerVibrato(when);
      this.volumeSlide(when, upDown, hiLo);
      break;
    case 0x7: break; // TODO tremolo
    case 0x8: // set panning
      this.setPanning(when, effectParam);
      break;
    // case 0x9: break; sample offset see applyCommand
    case 0xa: // volume slide
      this.volumeSlide(when, upDown, hiLo);
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
	// 0x3-0x9 TODO
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
	case 0xd: break; // TODO delay note
	case 0xe: break; // TODO delay pattern
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
    case 0x1b: break; // TODO retrigger
    case 0x1d: break; // TODO tremor
    case 0x21: // extra fine portamento
      switch (hi) {
	case 0x1: // fine porta up
	case 0x2: // fine porta down
	  this.portamento(when, (hi == 0x1), lo / (0x40 * this.xm.currentTempo));
	  break;
       }
       break;
    default:
      /* TODO apply other channel effects */
  }
},

/* Process the volume column of a note. */
function applyVolume(when, volume) {
  var oldPbr = this.nextPbr;
  var hi = (volume >> 4);
  var lo = (volume & 0xf);
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
      this.volumeSlide(when, (hi == 0x6), lo);
      break;
    case 0x8: // fine volume slide down
    case 0x9: // fine volume slide up
      this.volumeSlide(when, (hi == 0x6), lo / this.xm.currentTempo);
      break;
    case 0xa: // set vibrato speed
      this.setVibratoTremolo(when, 'vibrato', 'rate', (lo << 2), true);
      break;
    case 0xb: // perform vibrato and set depth
      this.setVibratoTremolo(when, 'vibrato', 'depth', lo);
      break;
    case 0xc: // set panning
      this.setPanning(when, (lo << 4));
      break
    case 0xd: // panning slide left
    case 0xe: // panning slide right
      // TODO
      break;
    case 0xf: // portamento towards note
      if (lo > 0) { this.portamentoRate = (lo << 4); }
      this.portamento(when, (this.targetPbr > oldPbr), this.portamentoRate, this.targetPbr);
      break;
  }
},

function portamento(when, up, rate, stopAtPbr) {
  var oldPbr = this.nextPbr;
  var pbrFactor = this.xm.portaToPlaybackRateFactor(rate);
  var newPbr = (up ? (oldPbr * pbrFactor) : (oldPbr / pbrFactor));
  var durationFactor = 1;
  if (stopAtPbr !== undefined &&
      (up ? (newPbr > stopAtPbr) : (newPbr < stopAtPbr))) {
    var currentPbrFactor = newPbr / oldPbr; // includes effect of up
    var targetPbrFactor = stopAtPbr / oldPbr;
    var durationFactor = Math.log(targetPbrFactor) / Math.log(currentPbrFactor);
    newPbr = stopAtPbr;
  }
  var rowEndTime = when + (this.xm.rowDuration() * durationFactor);
  if (this.bs !== undefined) {
    this.bs.playbackRate.exponentialRampToValueAtTime(newPbr, rowEndTime);
  }
  this.nextPbr = newPbr;
},

function getFadeoutVolume(when, unfadedVolume) {
  if (this.notePhase != 'release' || this.instrument.volumeFadeout == 0) {
    return unfadedVolume;
  } else {
    // FIXME what if BPM changes?
    return unfadedVolume *
      (1 - (this.xm.tickDuration() * this.instrument.volumeFadeout / 0x10000));
  }
},

/* Set the actual note volume 0-0x40 (not the volume column, not the envelope).
 */
function setVolume(when, volume) {
  if (when === undefined) { when = actx.currentTime; }
  this.volume = volume;
  if (this.notePhase != 'off') {
    var volumeFraction = this.getFadeoutVolume(when, volume / 0x40);
    if (when > actx.currentTime) {
      this.volumeNode.gain.setValueAtTime(volumeFraction, when);
    } else {
      this.volumeNode.gain.value = volumeFraction;
    }
    if (this.notePhase == 'release' && this.instrument.volumeFadeout != 0) {
      // FIXME what if BPM changes?
      var fadeoutEndTime = // time when volume reaches 0
        when +
        volumeFraction * this.xm.tickDuration() * 0x10000 /
	this.instrument.volumeFadeout
      this.volumeNode.gain.linearRampToValueAtTime(0, fadeoutEndTime);
    }
  }
},

/* Slide volume in ±64ths of full volume per tick. */
function volumeSlide(when, up, rate) {
  // FIXME how does this interact with instrument volume fadeout?
  var duration = this.xm.rowDuration();
  var oldVolume = this.volume;
  var newVolume = oldVolume + (up ? 1 : -1) * rate * this.xm.currentTempo;
  // clamp 0-0x40
  if (newVolume < 0) {
    newVolume = 0;
  } else if (newVolume > 0x40) {
    newVolume = 0x40;
  }
  this.volume = newVolume; // for next row
  if (this.notePhase != 'off') {
    // FIXME should I make sure it's exactly oldVolume at "when", in case it's
    // not now?
    this.volumeNode.gain.linearRampToValueAtTime(
	newVolume / 0x40, when + duration);
  }
},

/* Set the note panning (not the envelope). */
function setPanning(when, panning) {
  this.panning = panning;
  if (this.notePhase != 'off' && haveStereoPanner) {
    if (when > actx.currentTime) {
      this.panningNode.pan.setValueAtTime((panning - 0x80) / 0x80, when);
    } else {
      this.panningNode.pan.value = (panning - 0x80) / 0x80;
    }
  }
},

/* Set a vibrato or tremolo (depending on "which") parameter (depending on
 * "key") to "val". Automatically set this[which].on based on the new settings.
 * Keys and vals are in terms of autovibrato, though this is used for dynamic
 * vibrato; pay attention to units and the options for "type".
 */
function setVibratoTremolo(when, which, key, val, dontTrigger) {
  this[which][key] = val;
  if (this[which].on) { // already on
    if (this[which].depth != 0 && this[which].rate != 0) { // and staying on
      // adjust AudioParams
      // TODO factor this out and reuse in trigger{Vibrato|Tremolo}
      switch (key) {
	case 'depth':
	  switch (which) {
	    case 'vibrato':
	      // convert 16ths of a semitone to cents
	      var gain = val * 100 / 16;
	      if (this.vibrato.type == 4) { // saw down
		gain = -gain;
	      }
	      this.vibratoAmplitudeNode.gain.value = gain;
	      break;
	    case 'tremolo':
	      // TODO
	      break;
	  }
	  break;
	case 'rate':
	  // convert 256ths of a cycle per tick to Hz
	  var freq = this.vibrato.rate / (this.xm.tickDuration() * 256);
	  this.vibratoNode.frequency.value = freq;
	  break;
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
},

/* Begin volume/panning envelope (depending on "which"). */
function triggerEnvelope(when, which, firstPoint) {
  if (when < 0) { throw "WTF"; }
  if (firstPoint === undefined) { firstPoint = 0; }
  var envelope = this.instrument[which + 'Envelope'];
  var envelopeNode = this[which + 'EnvelopeNode'];
  var param = (which == 'volume') ? 'gain' : 'pan';
  for (var i = firstPoint; i < envelope.length; i++) {
    // FIXME what if BPM changes? should we only be scheduling the envelope a row at a time?
    var delay = envelope[i][0] * this.xm.tickDuration();
    var targetTime = when + delay;
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
},

/* Sustain volume/panning envelope by looping back to the loop start position.
 */
function loopEnvelope(when, which) {
  if (when < 0) { throw "WTF"; }
  var loopStartPoint = this.instrument[which + 'LoopStartPoint'];
  var timeUntilLoopStart =
    this.instrument[which + 'Envelope'][loopStartPoint][0] *
    this.xm.tickDuration(); // FIXME what if BPM changes?
  this.triggerEnvelope(when - timeUntilLoopStart, which, loopStartPoint);
},

/* End the sustain phase of volume/panning envelope and enter the release
 * phase.
 */
function releaseEnvelope(when, which) {
  var envelopeNode = this[which + 'EnvelopeNode'];
  if (envelopeNode !== undefined) {
    // schedule post-sustain part
    // TODO check if loop is (uselessly) entirely before sustain?
    if ((which + 'SustainPoint') in this.instrument) {
      var sustainPoint = this.instrument[which + 'SustainPoint'];
      var timeUntilSustain =
        this.instrument[which + 'Envelope'][sustainPoint][0] *
	this.xm.tickDuration(); // FIXME what if BPM changes?
      var sustainTime = this.lastTriggerTime + timeUntilSustain;
      if (when > sustainTime) {
	this.triggerEnvelope(when - timeUntilSustain, which, sustainPoint);
      } else {
	this.triggerEnvelope(this.lastTriggerTime, which, sustainPoint);
      }
    }
  }
},

/* Stop using volume/panning envelope (no release phase). */
function cutEnvelope(when, which) {
  var envelopeNode = this[which + 'EnvelopeNode'];
  if (envelopeNode !== undefined) {
    envelopeNode[(which == 'volume') ? 'gain' : 'pan']. // FIXME ugh
      cancelScheduledValues(when);
    if ((which + 'CancelLoop') in this) {
      this[which + 'CancelLoop']();
    }
  }
},

/* Set up nodes and trigger vibrato. */
function triggerVibrato(when) {
  // get rid of previous vibrato
  if (this.vibrato.on) { this.cutVibrato(when); }
  this.vibrato.on = true;
  this.vibratoAmplitudeNode = actx.createGain();
  this.vibratoAmplitudeNode.connect(this.bs.detune);
  var gain = this.vibrato.depth * 16 / 100; // cents
  this.vibratoNode = actx.createOscillator();
  this.vibratoNode.connect(this.vibratoAmplitudeNode);
  // convert 256ths of a cycle per tick to Hz
  var freq = this.vibrato.rate / (this.xm.tickDuration() * 256);
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
      console.log('WARNING: bogus vibrato type ' + this.vibrato.type);
  }
  if (this.vibrato.sweep == 0) {
    this.vibratoAmplitudeNode.gain.value = gain;
  } else {
    var sweepEndTime = when + this.vibrato.sweep * this.xm.tickDuration();
    this.vibratoAmplitudeNode.gain.value = 0;
    this.vibratoAmplitudeNode.gain.linearRampToValueAtTime(gain, sweepEndTime);
  }
  this.vibratoNode.start(when);
},

/* Stop vibrato and tear down nodes. */
function cutVibrato(when) {
  this.vibrato.on = false;
  this.vibratoNode.stop(when);
  this.vibratoAmplitudeNode.disconnect();
  this.vibratoNode.disconnect();
  this.vibratoAmplitudeNode = undefined;
  this.vibratoNode = undefined;
},

/* Set up nodes and trigger tremolo. */
function triggerTremolo(when) {
  // TODO like vibrato but with volume instead of detune (may need extra volume node?)
},

/* Stop tremolo and tear down nodes. */
function cutTremolo(when) {
  // TODO
}

// end Channel methods
].forEach(function(fn) { Channel.prototype[fn.name] = fn; });

