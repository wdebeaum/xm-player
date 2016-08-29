function vibratoTremoloWaveform(lo) {
  return ((lo&4) ? 'continuous ' : '') +
    switch (lo&3) {
      case 0: 'sine'; break;
      case 1: 'ramp down'; break;
      case 2: 'square'; break;
    };
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
  var effectTooltip =
    switch (note[3]) {
      case 0x00:
        if (note[4]) {
	  'arpeggio: rotate pitch once per tick in this row, among the original, ' + hi + ' semitones up, and ' + lo + ' semitones up'
	} else {
	  undefined;
	}
	break;
      case 0x01:
        'portamento up by ' + effParam + ' 16ths of a semitone per tick in this row';
	break;
      case 0x02:
        'portamento down by ' + effParam ' 16ths of a semitone per tick in this row';
	break;
      case 0x03:
        'portamento towards this note (instead of triggering it) by ' + effParam + ' 16ths of a semitone per tick in this row';
	break;
      case 0x04:
        'vibrato'; // TODO
	break;
      case 0x05:
        'portamento towards this note (instead of triggering it), and volume slide ' + (hi ? 'up by ' + hi : 'down by ' + lo); // TODO volume slide units
	break;
      case 0x06:
        'vibrato ???, and volume slide ' + upDown; // TODO volume slide units
	break;
      case 0x07:
        'tremolo at speed ' + hi + ' and depth ' + lo; // TODO units
	break;
      case 0x08:
        'set panning to ' + effParam + ' / 0xff right';
	break;
      case 0x09:
        'start playing the sample for this note at ' + effParam + ' * 0x100 bytes into the sample';
	break;
      case 0x0a:
        'volume slide ' + upDown; // TODO units
	break;
      case 0x0b:
        'jump to song position ' + effParam + ' in pattern order table';
	break;
      case 0x0c:
        'set volume to ' + effParam + ' / 0x40';
	break;
      case 0x0d:
        'jump to row ' + hi + lo + ' in next pattern in pattern order table';
	break;
      case 0x0e:
        switch (hi) {
	  case 0x1:
	    'fine portamento up by ' + lo; // TODO units;
	    break;
	  case 0x2:
	    'fine portamento down by ' + lo; // TODO units;
	    break;
	  case 0x3:
	    'turn ' + (lo ? 'off' : 'on') + 'glissando mode (rounding portamento pitches to the nearest semitone)';
	    break;
	  case 0x4:
	    'set vibrato waveform to ' + vibratoTremoloWaveform(lo);
	    break;
	  case 0x5:
	    'set finetune to ' + (lo-8) + ' / 8 semitones';
	    break;
	  case 0x6:
	    if (lo == 0) {
	      'loop start point';
	    } else {
	      'loop end point; loop back to the start point (or the start of the whole pattern if there is none in this channel) ' + lo + ' times';
	    }
	    break;
	  case 0x7:
	    'set tremolo waveform to ' + vibratoTremoloWaveform(lo);
	    break;
	  case 0x9:
	    'retrigger note every ' + lo + ' ticks in this row';
	    break;
	  case 0xa:
	    'fine volume slide up ' + lo; // TODO units
	    break;
	  case 0xb:
	    'fine volume slide down ' + lo; // TODO units
	    break;
	  case 0xc:
	    'note cut: set note volume to 0 at tick ' + lo + ' in this row';
	    break;
	  case 0xd:
	    'delay note to tick ' + lo + 'in this row';
	    break;
	  case 0xe:
	    'delay progression of whole pattern for the duration that ' + lo + ' rows normally would have played';
	    break;
	  default:
	    undefined;
	}
        break;
      case 0x0f:
        if (effParam == 0) {
	  'stop playback';
	} else if (effParam < 0x20) {
	  'set tempo to ' + effParam + ' ticks per row';
	} else {
	  'set BPM to ' + effParam + ' (' + (note[4] / 2.5) + ' ticks per second)';
	}
	break;
      case 0x10: // G
        'set global volume to ' + effParam + ' / 0x40';
	break;
      case 0x11: // H
        'global volume slide ' + upDown; // TODO units
	break;
      case 0x14: // K
        'release note at tick ' + effParam + ' in this row';
	break;
      case 0x15: // L
        'volume envelope jump to ' + effParam + ' ticks';
	break;
      case 0x19: // P
        'panning slide ' + (hi ? 'right by ' + hi : 'left by ' + lo); // TODO units
	break;
      case 0x1b: // R
        // ugh.
        'retrigger note every ' + lo + ' ticks in this row' +
	  switch (hi) {
	    case 0x0:
	      ', sliding note volume by the previous value of this parameter';
	      break;
	    case 0x1: ', sliding note volume down by 1 / 0x40 per tick'; break;
	    case 0x2: ', sliding note volume down by 2 / 0x40 per tick'; break;
	    case 0x3: ', sliding note volume down by 4 / 0x40 per tick'; break;
	    case 0x4: ', sliding note volume down by 8 / 0x40 per tick'; break;
	    case 0x5: ', sliding note volume down by 16 / 0x40 per tick'; break;
	    case 0x6:
	      ', sliding note volume to 2/3 of its previous value each tick';
	      break;
	    case 0x7:
	      ', sliding note volume to 1/2 of its previous value each tick';
	      break;
	    case 0x8: ''; break;
	    case 0x9: ', sliding note volume up by 1 / 0x40 per tick'; break;
	    case 0xa: ', sliding note volume up by 2 / 0x40 per tick'; break;
	    case 0xb: ', sliding note volume up by 4 / 0x40 per tick'; break;
	    case 0xc: ', sliding note volume up by 8 / 0x40 per tick'; break;
	    case 0xd: ', sliding note volume up by 16 / 0x40 per tick'; break;
	    case 0xe:
	      ', sliding note volume to 3/2 of its previous value each tick';
	      break;
	    case 0xf:
	      ', sliding note volume to twice its previous value each tick';
	      break;
	  }
	  break;
	case 0x1d: // T
	  'tremor: toggle note volume between full (for ' + hi + ' ticks) and zero (for ' + lo + ' ticks)';
	  break;
	case 0x21: // X
	  switch (hi) {
	    case 0x1:
	      'extra fine portamento up by ' + lo; // TODO units
	      break;
	    case 0x2:
	      'extra fine portamento down by ' + lo; // TODO units
	      break;
	    default:
	      undefined;
	  }
	  break;
	default:
	  undefined;
    };
  return [
    switch (note[0]) {
      case 0:
	undefined;
	break;
      case 97:
        'release note';
	break;
      default:
        'trigger note';
    },
    undefined, // nothing interesting to say about instrument column
    switch (note[2] & 0xf0) {
      //case 0x00: nothing
      case 0x10:
      case 0x20:
      case 0x30:
      case 0x40:
      case 0x50:
        'set volume to 0x' + (note[2]-0x10).toString(16) + ' / 0x40';
	break;
      case 0x60:
        'volume slide down by ' + volParam; // TODO units
	break;
      case 0x70:
        'volume slide up by ' + volParam; // TODO units
	break;
      case 0x80:
        'fine volume slide down by ' + volParam; // TODO units
	break;
      case 0x90:
        'fine volume slide up by ' + volParam; // TODO units
	break;
      case 0xa0:
        'set vibrato speed to ' + volParam; // TODO units
	break;
      case 0xb0:
        'set vibrato ??? to ' + volParam; // TODO units, and which setting is this?!
	break;
      case 0xc0:
        'set panning to ' + volParam + ' / 0xf right';
	break;
      case 0xd0:
        'panning slide left by ' + volParam; // TODO units
	break
      case 0xe0:
        'panning slide right by ' + volParam; // TODO units
	break
      case 0xf0:
        'tone portamento by ' + volParam; // TODO units
	break;
      default:
        undefined;
    }
    effectTooltip,
    effectTooltip
  ];
}
