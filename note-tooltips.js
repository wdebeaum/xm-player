function vibratoTremoloWaveform(lo) {
  return ((lo&4) ? 'continuous ' : '') + (function() {
    switch (lo&3) {
      case 0: return 'sine';
      case 1: return 'ramp down';
      case 2: return 'square';
    }})();
}

/* Given a 5-element array representing an XM note/command, return a 5-element
 * array of tooltips to put on the corresponding <td> elements. */
function noteTooltips(note) {
  var volParam = '0x' + (note[2] & 0x0f).toString(16);
  var effParam = '0x' + note[4].toString(16);
  var hi = (note[4] >> 4);
  var lo = (note[4] & 0x0f);
  var upDown = (hi ? 'up by ' + hi : 'down by ' + lo);
  // use the same tooltip for the effect and its parameter since they're
  // tightly coupled
  var effectTooltip = (function() {
    switch (note[3]) {
      case 0x00:
        if (note[4]) {
	  return 'arpeggio: rotate pitch once per tick in this row, among the original, ' + hi + ' semitones up, and ' + lo + ' semitones up'
	} else {
	  return undefined;
	}
      case 0x01:
        return 'portamento up by ' + effParam + ' 16ths of a semitone per tick in this row';
      case 0x02:
        return 'portamento down by ' + effParam + ' 16ths of a semitone per tick in this row';
      case 0x03:
        return 'portamento towards this note (instead of triggering it) by ' + effParam + ' 16ths of a semitone per tick in this row';
      case 0x04:
        return 'vibrato: vary pitch ±' + lo + ' / 0xf semitone, at ' + hi + ' / 0x40 cycles per tick';
      case 0x05:
        return 'portamento towards this note (instead of triggering it) at previously set speed, and volume slide ' + upDown + ' / 0x40 of full volume, per tick';
      case 0x06:
        return 'do vibrato with previous parameters, and volume slide ' + upDown + ' / 0x40 of full volume, per tick';
      case 0x07:
        return 'tremolo: vary volume up and down by ' + lo + ' / 0xf of full volume, at ' + hi + ' / 0x40 cycles per tick';
      case 0x08:
        return 'set panning to ' + effParam + ' / 0xff right';
      case 0x09:
        return 'start playing the sample for this note at ' + effParam + ' * 0x100 bytes into the sample';
      case 0x0a:
        return 'volume slide ' + upDown + ' / 0x40 of full volume, per tick';
      case 0x0b:
        return 'jump to song position ' + effParam + ' in pattern order table after this row';
      case 0x0c:
        return 'set volume to ' + effParam + ' / 0x40';
      case 0x0d:
        return 'jump to row ' + hi + lo + ' in next pattern in pattern order table after this row';
      case 0x0e:
        switch (hi) {
	  case 0x1:
	    return 'fine portamento up by ' + lo + ' 16ths of a semitone per row';
	  case 0x2:
	    return 'fine portamento down by ' + lo + ' 16ths of a semitone per row';
	  case 0x3:
	    return 'turn ' + (lo ? 'off' : 'on') + 'glissando mode (rounding portamento pitches to the nearest semitone)';
	  case 0x4:
	    return 'set vibrato waveform to ' + vibratoTremoloWaveform(lo);
	  case 0x5:
	    return 'set finetune to ' + (lo-8) + ' / 8 semitones';
	  case 0x6:
	    if (lo == 0) {
	      return 'loop start point';
	    } else {
	      return 'loop end point; loop back to the start point (or the start of the whole pattern if there is none in this channel) ' + lo + ' times';
	    }
	  case 0x7:
	    return 'set tremolo waveform to ' + vibratoTremoloWaveform(lo);
	  case 0x9:
	    return 'retrigger note every ' + lo + ' ticks in this row';
	  case 0xa:
	    return 'fine volume slide up ' + lo + ' / 0x40 of full volume, per row';
	  case 0xb:
	    return 'fine volume slide down ' + lo + ' / 0x40 of full volume, per row';
	  case 0xc:
	    return 'note cut: set note volume to 0 at tick ' + lo + ' in this row';
	  case 0xd:
	    return 'delay note to tick ' + lo + 'in this row';
	  case 0xe:
	    return 'delay progression of whole pattern for the duration that ' + lo + ' rows normally would have played';
	  default:
	    return undefined;
	}
      case 0x0f:
        if (effParam == 0) {
	  return 'stop playback';
	} else if (effParam < 0x20) {
	  return 'set tempo to ' + effParam + ' ticks per row';
	} else {
	  return 'set BPM to ' + effParam + ' (' + (note[4] / 2.5) + ' ticks per second)';
	}
      case 0x10: // G
        return 'set global volume to ' + effParam + ' / 0x40';
      case 0x11: // H
        return 'global volume slide ' + upDown + ' / 0x40 of full volume, per tick';
      case 0x14: // K
        return 'release note at tick ' + effParam + ' in this row';
      case 0x15: // L
        return 'volume envelope jump to ' + effParam + ' ticks';
      case 0x19: // P
        return 'panning slide ' + (hi ? 'right by ' + hi : 'left by ' + lo) + ' / 0x100, per tick';
      case 0x1b: // R
        // ugh.
        return 'retrigger note every ' + lo + ' ticks in this row' + (function() {
	  switch (hi) {
	    case 0x0:
	      return ', sliding note volume by the previous value of this parameter';
	    case 0x1: return ', sliding note volume down by 1 / 0x40 per tick';
	    case 0x2: return ', sliding note volume down by 2 / 0x40 per tick';
	    case 0x3: return ', sliding note volume down by 4 / 0x40 per tick';
	    case 0x4: return ', sliding note volume down by 8 / 0x40 per tick';
	    case 0x5: return ', sliding note volume down by 16 / 0x40 per tick';
	    case 0x6:
	      return ', sliding note volume to 2/3 of its previous value each tick';
	    case 0x7:
	      return ', sliding note volume to 1/2 of its previous value each tick';
	    case 0x8: return '';
	    case 0x9: return ', sliding note volume up by 1 / 0x40 per tick';
	    case 0xa: return ', sliding note volume up by 2 / 0x40 per tick';
	    case 0xb: return ', sliding note volume up by 4 / 0x40 per tick';
	    case 0xc: return ', sliding note volume up by 8 / 0x40 per tick';
	    case 0xd: return ', sliding note volume up by 16 / 0x40 per tick';
	    case 0xe:
	      return ', sliding note volume to 3/2 of its previous value each tick';
	    case 0xf:
	      return ', sliding note volume to twice its previous value each tick';
	  }})();
	case 0x1d: // T
	  return 'tremor: toggle note volume between full (for ' + hi + ' ticks) and zero (for ' + lo + ' ticks)';
	case 0x20: // W
	  /* Supported only in BASS? See also:
	   * https://github.com/azuisleet/gmodmodules/blob/master/gm_bass/bass/bass.txt#L1688
	   * https://github.com/jllodra/cmod/blob/master/cmod/bassmod.h#L95
	   * http://wingzone.tripod.com/bassmod/BASSMOD_MusicSetSync.html
	   */
	  return 'sync: pass ' + effParam + ' to the synchronization callback';
	case 0x21: // X
	  switch (hi) {
	    case 0x1:
	      return 'extra fine portamento up by ' + lo + ' 64ths of a semitone per row';
	    case 0x2:
	      return 'extra fine portamento down by ' + lo + ' 64ths of a semitone per row';
	    default:
	      return undefined;
	  }
	default:
	  return undefined;
    }})();
  return [
    (function() { switch (note[0]) {
      case 0:
	return undefined;
      case 97:
        return 'release note';
      default:
        return 'trigger note';
    }})(),
    undefined, // nothing interesting to say about instrument column
    (function() { switch (note[2] & 0xf0) {
      //case 0x00: nothing
      case 0x10:
      case 0x20:
      case 0x30:
      case 0x40:
      case 0x50:
        return 'set volume to 0x' + (note[2]-0x10).toString(16) + ' / 0x40';
      case 0x60: // -
        return 'volume slide down by ' + volParam + ' / 0x40 of full volume, per tick';
      case 0x70: // +
        return 'volume slide up by ' + volParam + ' / 0x40 of full volume, per tick';
      case 0x80: // D
        return 'fine volume slide down by ' + volParam + ' / 0x40 of full volume, per row';
      case 0x90: // U
        return 'fine volume slide up by ' + volParam + ' / 0x40 of full volume, per row';
      case 0xa0: // S
        return 'set vibrato speed to ' + volParam + ' / 0x40 cycles per tick';
      case 0xb0: // V
        return 'vibrato: vary pitch ±' + volParam + ' / 0xf semitone, at previous speed';
      case 0xc0: // P
        return 'set panning to ' + volParam + ' / 0xf right';
      case 0xd0: // L
        return 'panning slide left by ' + volParam + ' / 0x100, per tick';
      case 0xe0: // R
        return 'panning slide right by ' + volParam + ' / 0x100, per tick';
      case 0xf0: // M
        return 'portamento towards this note (instead of triggering it) by ' + volParam + ' semitones per tick in this row';
      default:
        return undefined;
    }})(),
    effectTooltip,
    effectTooltip
  ];
}
