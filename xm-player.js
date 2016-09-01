if (!String.prototype.encodeHTML) {
  String.prototype.encodeHTML = function () {
    return this.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
  };
}

var noteLetters = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];
function noteNumberToName(num) {
  if (num == 97) {
    return 'off';
  } else if (num == 0) {
    return '···';
  } else if (num > 97) {
    return 'err';
  } else {
    num--;
    return '' + noteLetters[num % 12] + Math.floor(num / 12);
  }
}

// FIXME assumes linear frequency table
function computePlaybackRate(noteNum, relNoteNum, fineTune) {
  // this is different from the formula in the spec, but is more readable
  return Math.pow(2, (noteNum - 1 + relNoteNum - 48/*C-4*/ + fineTune/128)/12) * 8363 / 44100;
}

var actx;
// HTML elements
var xmUrlInput;
var songDiv;
var songTable;
var patternOrderDiv;
var patternsDiv;
var instrumentsDiv;
var rowHighlight;
function onBodyLoad() {
  actx = new AudioContext();
  xmUrlInput = document.getElementById('xm-url');
  songDiv = document.getElementById('song');
  songTable = document.getElementById('song-header');
  patternOrderDiv = document.getElementById('pattern-order-table');
  patternsDiv = document.getElementById('patterns');
  instrumentsDiv = document.getElementById('instruments');
  rowHighlight = document.getElementById('row-highlight');
  if (location.hash !== '') {
    var url = location.hash.slice(1); // remove # from beginning
    fetchUrlAndRead(url);
  }
}

function BinaryFileReader(file) {
  this.pos = 0;
  this.fileReader = new FileReader();
  var that = this;
  this.fileReader.onload = function() {
    that.buffer = that.fileReader.result;
    that.data = new DataView(that.buffer);
    that.onload();
  };
  //console.log('readAsArrayBuffer');
  this.fileReader.readAsArrayBuffer(file);
}

BinaryFileReader.prototype.readIntegers = function(count, signed, bytes, littleEndian) {
  var getter = 'get' + (signed ? 'Int' : 'Uint') + (bytes*8);
  var ret = []; // TODO make this a typed array?
  //console.log(getter + ' * ' + count);
  while (count--) {
    ret.push(this.data[getter](this.pos, littleEndian));
    this.pos += bytes;
  }
  return ret;
};
/* common count=1 cases */
BinaryFileReader.prototype.readUint8 = function() {
  return this.readIntegers(1, false, 1, true)[0];
}
BinaryFileReader.prototype.readUint16 = function() {
  return this.readIntegers(1, false, 2, true)[0];
}
BinaryFileReader.prototype.readUint32 = function() {
  return this.readIntegers(1, false, 4, true)[0];
}

BinaryFileReader.prototype.readZeroPaddedString = function(length) {
  var codes = this.readIntegers(length, false, 1);
  while (codes.length > 0 && codes[codes.length-1] == 0) {
    codes.pop();
  }
  return String.fromCharCode.apply(String, codes);
};

function XMReader(file) {
  this.masterVolume = actx.createGain();
  this.masterVolume.gain.value = 0.1;
  this.masterVolume.connect(actx.destination);
  this.binaryReader = new BinaryFileReader(file);
  this.channels = [];
  this.channelSettings = [];
  this.patterns = [];
  var that = this;
  this.binaryReader.onload = function() { return that.onBinaryLoad(); };
}

XMReader.prototype.onBinaryLoad = function() {
  this.readSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    this.readPattern(pi);
  }
  this.instruments = [];
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
    this.instruments.push(this.readInstrument());
  }
  console.log(this);
  if ('onload' in this) {
    this.onload();
  }
}

XMReader.prototype.drawSong = function() {
  this.drawSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    this.drawPattern(pi);
  }
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
    this.drawInstrument(ii);
  }
}

XMReader.prototype.readSongHeader = function() {
  var r = this.binaryReader;
  var idText = r.readZeroPaddedString(17);
  if (idText != 'Extended Module: ') {
    throw new Error('wrong ID text: ' + idText);
  }
  this.moduleName = r.readZeroPaddedString(20);
  var magic = r.readUint8();
  if (magic != 0x1a) {
    throw new Error('wrong magic byte: ' + magic);
  }
  this.trackerName = r.readZeroPaddedString(20);
  var versionNumber = r.readUint16();
  if (versionNumber != 0x0104) {
    throw new Error('wrong version number: ' + versionNumber);
  }
  var headerSize = r.readUint32();
  if (headerSize != 276) {
    throw new Error('wrong header size: ' + headerSize);
  }
  // TODO more errors/warnings
  this.songLength = r.readUint16();
  this.restartPosition = r.readUint16();
  this.numberOfChannels = r.readUint16();
  this.numberOfPatterns = r.readUint16();
  this.numberOfInstruments = r.readUint16();
  this.flags = r.readUint16();
  this.defaultTempo = r.readUint16();
  this.currentTempo = this.defaultTempo;
  this.defaultBPM = r.readUint16();
  this.currentBPM = this.defaultBPM;
  this.patternOrder = r.readIntegers(256, false, 1, true).slice(0,this.songLength);
}

XMReader.prototype.drawSongHeader = function() {
  songTable.innerHTML +=
    '<tr><td>Module name:</td><td>' +
      this.moduleName.encodeHTML() + '</td></tr>' +
    '<tr><td>Tracker name:</td><td>' +
      this.trackerName.encodeHTML() + '</td></tr>' +
    '<tr><td>Song length:</td><td>' +
      this.songLength + ' patterns<td></tr>' +
    '<tr><td>Restart position:</td><td>pattern ' +
      this.restartPosition + ' in pattern order</td></tr>' +
    '<tr><td>Number of channels:</td><td>' +
      this.numberOfChannels + '</td></tr>' +
    '<tr><td>Number of patterns:</td><td>' +
      this.numberOfPatterns + '</td></tr>' +
    '<tr><td>Number of instruments:</td><td>' +
      this.numberOfInstruments + '</td></tr>' +
    '<tr><td>Frequency table:</td><td>' +
      ((this.flags & 1) ? 'Linear' : 'Amiga') + '</td></tr>' +
    '<tr><td>Default tempo:</td><td>' +
      this.defaultTempo + ' ticks per row<td></tr>' +
    '<tr><td>Default BPM:</td><td>' +
      this.defaultBPM +
      ' (' + (this.defaultBPM/2.5) + ' ticks per second)<td></tr>';
  for (var i = 0; i < this.songLength; i++) {
    patternOrderDiv.innerHTML += ((i==0) ? '' : ', ') + this.patternOrder[i];
  }
}

XMReader.prototype.readPattern = function(pi) {
  var r = this.binaryReader;
  var patternHeaderLength = r.readUint32();
  if (patternHeaderLength != 9) { console.log('WARNING: wrong pattern header length; expected 9 but got ' + patternHeaderLength); }
  var packingType = r.readUint8();
  if (packingType != 0) { console.log('WARNING: wrong packing type; expected 0 but got 0x' + packingType.toString(16)); }
  var numberOfRows = r.readUint16();
  if (numberOfRows == 0) { console.log('WARNING: no rows'); }
  if (numberOfRows > 256) { console.log('WARNING: too many rows; expected <=256 but got ' + numberOfRows); }
  var packedPatternDataSize = r.readUint16();
  var packedPatternData = r.readIntegers(packedPatternDataSize, false, 1, true);
  // unpack
  var pat = [];
  this.patterns.push(pat);
  var row;
  var pdi = 0;
  var ci = 0;
  var actualNumberOfRows = 0;
  while (pdi < packedPatternData.length) {
    // start row if necessary
    if (ci == 0) {
      row = [];
      pat.push(row);
    }
    // decode note
    var note = [];
    row.push(note);
    if (packedPatternData[pdi] & 0x80) {
      var col = packedPatternData[pdi++];
      if (col & 1) {
        var noteNum = packedPatternData[pdi++];
	note.push(noteNum);
      } else {
	note.push(0);
      }
      for (var x = 1; x < 5; x++) {
	if (col & (1 << x)) {
	  var cell = packedPatternData[pdi++]
	  note.push(cell);
	} else {
	  note.push(0);
	}
      }
    } else {
      var noteNum = packedPatternData[pdi++];
      note.push(noteNum);
      for (var x = 1; x < 5; x++) {
	var cell = packedPatternData[pdi++];
	note.push(cell);
      }
    }
    // end row if necessary
    ci++;
    if (ci == this.numberOfChannels) {
      ci = 0;
      actualNumberOfRows++;
    }
  }
  if (actualNumberOfRows > 0 && // blank patterns are omitted
      actualNumberOfRows != numberOfRows) {
    console.log('WARNING: wrong number of rows; expected ' + numberOfRows + ' but got ' + actualNumberOfRows);
  }
  if (ci != 0) {
    console.log('WARNING: number of notes not divisible by number of channels; remainder=' + ci);
  }
}

function appendHeading(parentNode, level, text) {
  var h = document.createElement('h' + level);
  h.appendChild(document.createTextNode(text));
  parentNode.appendChild(h);
}

// onclick may be a string to put in the onclick attribute, or a function to
// assign to the onclick property
function appendButton(parentNode, label, onclick) {
  var button = document.createElement('button');
  switch (typeof onclick) {
    case 'string':
      button.setAttribute('onclick', onclick);
      break;
    case "function":
      button.onclick = onclick;
      break;
    case "undefined":
      // do nothing
      break;
    default:
      console.log('weird onclick value for button labeled ' + label);
      console.log(onclick);
  }
  button.appendChild(document.createTextNode(label));
  parentNode.appendChild(button);
}

function appendBreak(parentNode) {
  parentNode.appendChild(document.createElement('br'));
}

function appendLine(parentNode, text) {
  parentNode.appendChild(document.createTextNode(text));
  appendBreak(parentNode);
}

var volumeEffectLetters = ['-', '+', '▼', '▲', 'S', 'V', 'P', '◀', '▶', 'M'];

function formatVolume(val) {
  if (val == 0) {
    return '··';
  } else if (val < 0x60) {
    return val.toString(16);
  } else {
    return volumeEffectLetters[(val>>4)-6] + (val&0xf).toString(16);
  }
}

XMReader.prototype.drawPattern = function(pi) {
  appendHeading(patternsDiv, 3, 'Pattern ' + pi);
  appendButton(patternsDiv, '▶',
      this.playPattern.bind(this, this.patterns[pi], pi, 0, undefined, false, undefined));
  appendButton(patternsDiv, '↺',
      this.playPattern.bind(this, this.patterns[pi], pi, 0, undefined, true, undefined));
  appendBreak(patternsDiv);
  var table = '<tr><th title="row number">Rw</th>';
  var ci;
  for (ci = 0; ci < this.numberOfChannels; ci++) {
    table += '<th class="note" title="note">Not</th><th class="col-1" title="instrument">In</th><th class="col-2" title="volume">Vl</th><th class="col-3" title="effect type">E</th><th class="col-4" title="effect parameters">Pr</th>';
  }
  table += '</tr>';
  for (var ri = 0; ri < this.patterns[pi].length; ri++) {
    var row = this.patterns[pi][ri];
    table += '<tr id="pattern-' + pi + '-row-' + ri + '" class="row-' + (ri % 4) + '"><td class="row-num">' + ri.toString(16) + '</td>';
    for (var ci = 0; ci < row.length; ci++) {
      var note = row[ci];
      // get tooltips
      var tooltips = noteTooltips(note);
      // wrap them in title attribute if present
      for (var i = 0; i < 5; i++) {
	if (tooltips[i] === undefined) {
	  tooltips[i] = '';
	} else {
	  tooltips[i] = ' title="' + tooltips[i] + '"';
	}
      }
      // write table cells for note
      table +=
	'<td class="note"' + tooltips[0] + '>' +
	  noteNumberToName(note[0]) + '</td>' +
	'<td class="col-1"' + tooltips[1] + '>' +
	  ((note[1] == 0) ? '··' : note[1].toString(16)) + '</td>' +
	'<td class="col-2"' + tooltips[2] + '>' +
	  formatVolume(note[2]) + '</td>' +
	'<td class="col-3"' + tooltips[3] + '>' +
	  ((note[3] == 0 && note[4] == 0) ? '·' : note[3].toString(36)) +
	'</td>' +
	'<td class="col-4"' + tooltips[4] + '>' +
	  ((note[3] == 0 && note[4] == 0) ? '··' :
	    ((note[4] < 0x10) ? '0' : '') + note[4].toString(16)) +
	'</td>';
    }
    table += '</tr>';
  }
  var tableElement = document.createElement('table');
  patternsDiv.appendChild(tableElement);
  tableElement.innerHTML = table;
}

XMReader.prototype.readInstrument = function() {
  var r = this.binaryReader;
  var ret = {};
  var instrumentHeaderSize = r.readUint32();
  if (instrumentHeaderSize < 29) {
    console.log('WARNING: instrument header size too small; expected >=29 but got ' + instrumentHeaderSize);
  }
  ret.name = r.readZeroPaddedString(22);
  var instrumentType = r.readUint8();
  if (instrumentType != 0) { console.log('WARNING: wrong instrument type; expected 0 but got 0x' + instrumentType.toString(16)); }
  ret.numberOfSamples = r.readUint16();
  if (instrumentHeaderSize >= 243) {
    var sampleHeaderSize = r.readUint32();
    ret.sampleNumberForAllNotes = r.readIntegers(96, false, 1, true);
    // volume and panning envelopes
    var pointsForVolumeEnvelope = r.readIntegers(24, false, 2, true);
    var pointsForPanningEnvelope = r.readIntegers(24, false, 2, true);
    var numberOfVolumePoints = r.readUint8();
    var numberOfPanningPoints = r.readUint8();
    var volumeSustainPoint = r.readUint8();
    var volumeLoopStartPoint = r.readUint8();
    var volumeLoopEndPoint = r.readUint8();
    var panningSustainPoint = r.readUint8();
    var panningLoopStartPoint = r.readUint8();
    var panningLoopEndPoint = r.readUint8();
    var volumeType = r.readUint8();
    var panningType = r.readUint8();
    this.interpretVolumePanning(ret, 'volume', pointsForVolumeEnvelope, numberOfVolumePoints, volumeSustainPoint, volumeLoopStartPoint, volumeLoopEndPoint, volumeType);
    this.interpretVolumePanning(ret, 'panning', pointsForPanningEnvelope, numberOfPanningPoints, panningSustainPoint, panningLoopStartPoint, panningLoopEndPoint, panningType);
    // vibrato
    ret.vibratoType = r.readUint8();
    ret.vibratoSweep = r.readUint8();
    ret.vibratoDepth = r.readUint8();
    ret.vibratoRate = r.readUint8();
    // other
    ret.volumeFadeout = r.readUint16();
    var reserved = r.readUint16();
    if (instrumentHeaderSize > 243) {
      var count = instrumentHeaderSize - 243;
      console.log('WARNING: ignoring ' + count + ' extra bytes after first 243 bytes of instrument header');
      r.readIntegers(count, false, 1, true);
    }
  } else if (instrumentHeaderSize > 29) {
    var count = instrumentHeaderSize - 29;
    console.log('WARNING: ignoring ' + count + ' extra bytes after first 29 bytes of instrument header');
    r.readIntegers(count, false, 1, true);
  }
  ret.samples = [];
  for (var si = 0; si < ret.numberOfSamples; si++) {
    ret.samples.push(this.readSampleHeader());
  }
  for (var si = 0; si < ret.numberOfSamples; si++) {
    this.readSampleData(ret.samples[si]);
  }
  return ret;
}

var vibratoTypes = ['sine', 'square', 'saw down', 'saw up'];

XMReader.prototype.drawInstrument = function(ii) {
  appendHeading(instrumentsDiv, 3, 'Instrument ' + (ii+1).toString(16));
  appendButton(instrumentsDiv, '▶',
      this.playNote.bind(this, [65, ii+1, 0,0,0], 0));
  appendBreak(instrumentsDiv);
  var ret = this.instruments[ii];
  appendLine(instrumentsDiv, 'Name: ' + ret.name);
  if (ret.numberOfSamples > 1 && 'sampleNumberForAllNotes' in ret) {
    var snfan = 'Sample number for all notes:';
    for (var i = 0; i < 96; i++) {
      snfan += ' ' + ret.sampleNumberForAllNotes[i];
    }
    appendLine(instrumentsDiv, snfan);
  }
  this.drawVolumePanning(ret, 'volume');
  this.drawVolumePanning(ret, 'panning');
  if (ret.vibratoType || ret.vibratoSweep || ret.vibratoDepth || ret.vibratoRate) {
    appendLine(instrumentsDiv, 'Vibrato: ' + vibratoTypes[ret.vibratoType] + '(sweep=reach full depth at ' + ret.vibratoSweep + ' ticks after vibrato start; depth = ±' + ret.vibratoDepth + ' / 16 semitones; rate=' + ret.vibratoRate + ' / 256 cycles per tick)');
  }
  appendLine(instrumentsDiv, 'Volume fadeout: ' + ret.volumeFadeout);
  for (var si = 0; si < ret.numberOfSamples; si++) {
    appendHeading(instrumentsDiv, 4, 'Sample ' + si);
    this.drawSampleHeader(ret.samples[si]);
    this.drawSampleData(ret.samples[si]);
  }
}

XMReader.prototype.interpretVolumePanning = function(ret, volumeOrPanning, points, numberOfPoints, sustainPoint, loopStartPoint, loopEndPoint, type) {
  if (type & 1) { // On
    var envelope = ret[volumeOrPanning + 'Envelope'] = [];
    for (var i = 0; i < numberOfPoints; i++) {
      envelope.push(points.slice(i*2,i*2+2));
    }
    if (type & 2) { // Sustain
      ret[volumeOrPanning + 'SustainPoint'] = sustainPoint;
    }
    if (type & 4) { // Loop
      ret[volumeOrPanning + 'LoopStartPoint'] = loopStartPoint;
      ret[volumeOrPanning + 'LoopEndPoint'] = loopEndPoint;
    }
  }
}

var svgNS = 'http://www.w3.org/2000/svg';

XMReader.prototype.drawVolumePanning = function(ret, volumeOrPanning) {
  if ((volumeOrPanning + 'Envelope') in ret) {
    appendHeading(instrumentsDiv, 4,
	// capitalize
	volumeOrPanning.slice(0,1).toUpperCase() + volumeOrPanning.slice(1));
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width',128);
    svg.setAttribute('height',128);
    instrumentsDiv.appendChild(svg);
    var bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x',0);
    bg.setAttribute('y',0);
    bg.setAttribute('width',64);
    bg.setAttribute('height',64);
    svg.appendChild(bg);
    var p = document.createElementNS(svgNS, 'path');
    var path = '';
    var envelope = ret[volumeOrPanning + 'Envelope'];
    for (var i = 0; i < envelope.length; i++) {
      path += (i == 0 ? 'M ' : ' L ') + envelope[i][0] + ' ' + (64-envelope[i][1]);
    }
    p.setAttribute('d', path);
    svg.appendChild(p);
    appendBreak(instrumentsDiv);
    if ((volumeOrPanning + 'SustainPoint') in ret) {
      appendLine(instrumentsDiv, 'Sustain point: ' + ret[volumeOrPanning + 'SustainPoint']);
    }
    if ((volumeOrPanning + 'LoopStartPoint') in ret) { // Loop
      appendLine(instrumentsDiv, 'Loop: ' + ret[volumeOrPanning + 'LoopStartPoint'] + '-' + ret[volumeOrPanning + 'LoopEndPoint']);
    }
  }
}

XMReader.prototype.readSampleHeader = function() {
  var r = this.binaryReader;
  var s = {};
  s.lengthInBytes = r.readUint32();
  s.loopStart = r.readUint32();
  s.loopLength = r.readUint32();
  s.volume = r.readUint8();
  s.finetune = r.readIntegers(1, true, 1, true)[0];
  var type = r.readUint8();
  s.loopType = (type & 3);
  s.bytesPerSample = ((type & (1<<4)) ? 2 : 1);
  s.panning = r.readUint8();
  s.relativeNoteNumber = r.readIntegers(1, true, 1, true)[0];
  var reserved = r.readUint8();
  s.name = r.readZeroPaddedString(22);
  return s;
}

var loopTypes = ['none', 'forward', 'ping-pong'];

XMReader.prototype.drawSampleHeader = function(s) {
  var table = document.createElement('table');
  instrumentsDiv.appendChild(table);
  table.innerHTML =
    '<tr><td>Name:</td><td>' + s.name + '</td></tr>' +
    '<tr><td>Relative note number:</td><td>' + s.relativeNoteNumber + ' semitones</td></tr>' +
    '<tr><td>Finetune:</td><td>' + s.finetune + ' / 128 semitones</td></tr>' +
    '<tr><td>Volume:</td><td>' + s.volume + ' / 64</td></tr>' +
    '<tr><td>Panning:</td><td>' + s.panning + ' / 255 right</td></tr>';
  if (s.loopType) {
    table.innerHTML +=
      '<tr><td>Loop:</td><td>' + loopTypes[s.loopType] + ' ' + s.loopStart + ' bytes - ' + (s.loopLength + s.loopStart) + ' bytes</td></tr>';
  }
  table.innerHTML +=
    '<tr><td>Length:</td><td>' + s.lengthInBytes + ' bytes (' + s.bytesPerSample + ' byte(s) per sample)</td></tr>';
}

XMReader.prototype.readSampleData = function(s) {
  var deltas = this.binaryReader.readIntegers(s.lengthInBytes / s.bytesPerSample, true, s.bytesPerSample, true);
  s.data = [];
  var old = 0;
  for (var i = 0; i < deltas.length; i++) {
    var neww = old + deltas[i];
    // discard overflow
    neww %= (1 << (8*s.bytesPerSample));
    s.data.push(neww);
    old = neww;
  }
}

XMReader.prototype.drawSampleData = function(s) {
  // draw waveform on a canvas
  var canvas = document.createElement('canvas');
  canvas.setAttribute('height', 256);
  var horizDivisor = Math.floor(s.data.length / 512);
  if (horizDivisor == 0) { horizDivisor = 1; }
  canvas.setAttribute('width', 512);
  instrumentsDiv.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  var min = 256;
  var max = 0;
  for (var i = 0; i < s.data.length; i++) {
    var scaled = 128 + ((s.bytesPerSample == 2) ? Math.trunc(s.data[i]/256) : s.data[i]);
    if (scaled < min) { min = scaled; }
    if (scaled > max) { max = scaled; }
    if ((i % horizDivisor) == 0) {
      //console.log('i=' + i + '; min=' + min + '; max=' + max);
      ctx.fillRect(Math.floor(i/horizDivisor), min, 1, max-min+1);
      min = 256;
      max = 0;
    }
  }
  appendBreak(instrumentsDiv);
  appendButton(instrumentsDiv, '▶',
    function() {
      var bs = sampleDataToBufferSource(s.data, s.bytesPerSample);
      // TODO apply sample volume (0-64), panning (left 0 - right 255)
      bs.playbackRate = computePlaybackRate(64, s.relativeNoteNumber, s.finetune);
      bs.connect(xm.masterVolume);
      bs.start();
    }
  );
}

// return the factor to multiply (porta up) or divide (porta down) the playback
// rate by for an entire row (not just one tick) for the given effect parameter
// value
// effectParam is in 16ths of a semitone per tick
XMReader.prototype.portaToPlaybackRateFactor = function(effectParam) {
  return Math.pow(2, effectParam * this.currentTempo / (16*12));
}

/* One channel/track as it plays notes. */
function Channel(xm) {
  this.xm = xm;
  this.reset();
}

[ // begin Channel methods

function reset() {
  // XM stuff
  this.noteNum = 0;
  this.instrument = undefined;
  this.sample = undefined;
  this.volume = 0x40; // silent 0x00 - 0x40 full
  this.panning = 0x80; // left 0x00 - 0xff right
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
  if (this.isPlaying()) {
    this.cutNote(when);
  }
  // get XM resources/settings
  this.instrument = xm.instruments[instrumentNum];
  var sample = this.instrument.sampleNumberForAllNotes[noteNum];
  this.nextPbr =
    computePlaybackRate(noteNum, sample.relativeNoteNumber, sample.finetune);
  this.vibrato.on = (this.instrument.vibratoDepth != 0 && this.instrument.vibratoRate != 0);
  this.vibrato.type = this.instrument.vibratoType;
  this.vibrato.sweep = this.instrument.vibratoSweep;
  this.vibrato.depth = this.instrument.vibratoDepth;
  this.vibrato.rate = this.instrument.vibratoRate;
  // set up node graph
  this.volumeNode = actx.createGain();
  this.volumeNode.connect(xm.masterVolume);
  var downstream = this.volumeNode;
  if ('volumeEnvelope' in this.instrument) {
    this.volumeEnvelopeNode = actx.createGain();
    this.volumeEnvelopeNode.connect(downstream);
    downstream = this.volumeEnvelopeNode;
  }
  this.panningNode = actx.createStereoPanner();
  this.panningNode.connect(downstream);
  downstream = this.panningNode;
  if ('panningEnvelope' in this.instrument) {
    this.panningEnvelopeNode = actx.createStereoPanner();
    this.panningEnvelopeNode.connect(downstream);
    downstream = this.panningEnvelopeNode;
  }
  this.bs = sampleDataToBufferSource(sample.data, sample.bytesPerSample);
  if (sample.loopType) {
    // TODO ping-pong
    this.bs.loop = true;
    this.bs.loopStart = sample.loopStart / sample.bytesPerSample / 44100;
    this.bs.loopEnd = (sample.loopStart + sample.loopLength) / sample.bytesPerSample / 44100;
  }
  this.bs.connect(downstream);
  // NOTE: Vibrato nodes are created in triggerVibrato since that can happen at
  // other times too, and tremolo nodes are created/destroyed in triggerTremolo.
  // apply settings to nodes
  this.bs.playbackRate.value = nextPbr;
  setVolume(sample.volume);
  setPanning(sample.panning);
  // trigger everything
  this.startTime = when;
  if ('volumeEnvelope' in this.instrument) { triggerEnvelope(when, 'volume'); }
  if ('panningEnvelope' in this.instrument){ triggerEnvelope(when, 'panning'); }
  if (this.vibrato.on) { this.triggerVibrato(when); }
  // trigger sample
  if (offsetInBytes != 0) {
    var offsetInSamples = offsetInBytes / sample.bytesPerSample;
    var offsetInSeconds = offsetInSamples / 44100;
    this.bs.start(when, offsetInSeconds);
  } else {
    this.bs.start(when);
  }
},

/* End the sustain phase of playing the note and enter the release phase. */
function releaseNote(when) {
  // TODO
  releaseEnvelope(when, 'volume');
  releaseEnvelope(when, 'panning');
},

/* Stop playing the note (no release phase). */
function cutNote(when) {
  // TODO
  cutEnvelope(when, 'volume');
  cutEnvelope(when, 'panning');
},

/* Return true iff a note is currently playing on this channel (even in release
 * phase).
 */
function isPlaying() {
  // TODO
},

/* Process a 5-element note/command array from a pattern. */
function applyCommand(when, note) {
  var noteNum = note[0];
  var instrumentNum = note[1];
  var volume = note[2];
  var effectType = note[3];
  var effectParam = note[4];
  var sampleOffset = 0;
  if (effectType == 0x09) { sampleOffset = effectParam * 0x100; /* bytes */ }
  var triggerDelay = 0;
  if (effectType == 0x0e && (effectParam >> 4) == 0xd) { // delay note
    triggerDelay = xm.tickDuration() * (effectParam & 0xf);
  }
  if (effectType == 0x03 || effectType == 0x05 ||
      (volume & 0xf0) == 0xf0) {
    // portamento to note, don't trigger a new note
  } else if (effectType == 0x0e && (effectParam >> 4) == 0xe) {
    // delay pattern
    // TODO
  } else if (noteNum == 96) {
    releaseNote(when + triggerDelay);
  } else if (noteNum > 0 && noteNum < 96) {
    triggerNote(when + triggerDelay, noteNum, instrumentNum, sampleOffset);
  }
  applyVolume(when, volume);
  applyEffect(when, effectType, effectParam);
},

/* Process the effect/param portion of a note. */
function applyEffect(when, effectType, effectParam) {
  // TODO
},

/* Process the volume column of a note. */
function applyVolume(when, volume) {
  // TODO
},

/* Set the actual note volume (not the volume column, not the envelope). */
function setVolume(when, volume) {
  // TODO
},

/* Set the note panning (not the envelope). */
function setPanning(when, panning) {
  // TODO
},

/* Set a vibrato or tremolo (depending on "which") parameter (depending on
 * "key") to "val". Automatically set this[which].on based on the new settings.
 */
function setVibratoTremolo(when, which, key, val) {
  // TODO
},

/* Begin volume/panning envelope (depending on "which"). */
function triggerEnvelope(when, which) {
  // TODO
},

/* Sustain volume/panning envelope by looping back to the loop start position.
 */
function loopEnvelope(when, which) {
  // TODO
},

/* End the sustain phase of volume/panning envelope and enter the release
 * phase.
 */
function releaseEnvelope(when, which) {
  // TODO
},

/* Stop using volume/panning envelope (no release phase). */
function cutEnvelope(when, which) {
  // TODO
},

/* Set up nodes and trigger vibrato. */
function triggerVibrato(when) {
  // TODO
},

/* Stop vibrato and tear down nodes. */
function cutVibrato(when) {
  // TODO
},

/* Set up nodes and trigger tremolo. */
function triggerTremolo(when) {
  // TODO
},

/* Stop tremolo and tear down nodes. */
function cutTremolo(when) {
  // TODO
}

// end Channel methods
].forEach(function(fn) { Channel.prototype[fn.name] = fn; });

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

function PlayingNote(note, xm, channel) {
  var noteNum = note[0];
  var instrumentNum = note[1];
  var volume = note[2];
  var effectType = note[3];
  var effectParam = note[4];
  if (effectType == 0xf) { // set tempo/BPM
    if (effectParam < 0x20) { // set tempo
      xm.currentTempo = effectParam;
    } else { // set BPM
      xm.currentBPM = effectParam; // not - 0x20?
    }
  } // TODO other global effects?
  if (noteNum == 0) {
    if (channel !== undefined &&
        xm.channels[channel] !== undefined) {
      var that = xm.channels[channel];
      if (volume != 0) {
	that.setVolume(volume);
      }
      that.applyEffect(xm, effectType, effectParam);
    }
    return;
  }
  if (channel !== undefined) {
    // stop previous note on this channel
    if (xm.channels[channel] !== undefined) {
      xm.channels[channel].stop();
      xm.channels[channel] = undefined;
    }
    // get/set default settings for channel
    if (xm.channelSettings[channel] === undefined) {
      xm.channelSettings[channel] = note.slice(0); // clone array
    } else {
      if (instrumentNum == 0) {
	instrumentNum = xm.channelSettings[channel][1];
      } else {
	xm.channelSettings[channel][1] = instrumentNum;
      }
      // TODO other settings?
    }
  }
  if (noteNum >= 97) { return; } // not a note
  this.inst = xm.instruments[instrumentNum-1];
  var sampleNum = this.inst.sampleNumberForAllNotes[noteNum];
  var samp = this.inst.samples[sampleNum];
  this.volumeNode = actx.createGain();
  this.setVolume(volume, samp.volume);
  this.volumeNode.connect(xm.masterVolume);
  this.panningNode = actx.createStereoPanner();
  this.setPanning(samp.panning);
  this.panningNode.connect(this.volumeNode);
  this.bs = sampleDataToBufferSource(samp.data, samp.bytesPerSample);
  var pbr = computePlaybackRate(noteNum, samp.relativeNoteNumber, samp.finetune);
  this.nextPbr = pbr;
  this.bs.playbackRate.value = pbr;
  this.applyEffect(xm, effectType, effectParam);
  if (samp.loopType) {
    // TODO ping-pong
    this.bs.loop = true;
    this.bs.loopStart = samp.loopStart / samp.bytesPerSample / 44100;
    this.bs.loopEnd = (samp.loopStart + samp.loopLength) / samp.bytesPerSample / 44100;
  }
  if ('volumeEnvelope' in this.inst) {
    this.startTime = actx.currentTime;
    this.envelopeNode = actx.createGain();
    this.setEnvelope();
    this.envelopeNode.connect(this.panningNode);
    this.bs.connect(this.envelopeNode);
  } else {
    this.bs.connect(this.panningNode);
  }
  if (channel !== undefined) {
    xm.channels[channel] = this;
  }
  if (effectType == 0x9) { // sample offset
    var offsetInBytes = effectParam * 0x100;
    var offsetInSamples = offsetInBytes / samp.bytesPerSample;
    var offsetInSeconds = offsetInSamples / 44100;
    this.bs.start(0, offsetInSeconds);
  } else {
    this.bs.start();
  }
  // stop looping when we reach the end of an envelope that ends at 0 volume
  if (this.bs.loop && 'volumeEnvelope' in this.inst &&
      this.inst.volumeEnvelope[this.inst.volumeEnvelope.length-1][1] == 0) {
    this.stop(actx.currentTime + this.inst.volumeEnvelope[this.inst.volumeEnvelope.length-1][0] * 2.5 / xm.currentBPM);
  }
}

PlayingNote.prototype.applyEffect = function(xm, effectType, effectParam) {
  // NOTE: this.bs.playbackRate.value might be wrong in the context of the
  // song; we always set this.nextPbr to the value it *should* be at the start
  // of the next row
  var oldPbr = this.nextPbr;
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
	for (var i = 0, t = actx.currentTime;
	     i < xm.currentTempo; // ticks per row
	     i++, t += xm.tickDuration()) {
	  this.bs.playbackRate.setValueAtTime(pbrs[i%3], t);
	}
	// set back to oldPbr after row finishes
	this.bs.playbackRate.setValueAtTime(oldPbr, t);
      }
      break;
    case 0x1: // porta up effectParam 16ths of a semitone per tick
    case 0x2: // porta down
      var pbrFactor = xm.portaToPlaybackRateFactor(effectParam);
      var newPbr =
        ((effectType == 0x1) ? (oldPbr * pbrFactor) : (oldPbr / pbrFactor));
      var rowEndTime = actx.currentTime + xm.rowDuration();
      this.bs.playbackRate.exponentialRampToValueAtTime(newPbr, rowEndTime);
      this.nextPbr = newPbr;
      break;
    case 0xb: // jump to song position
      xm.nextSongPosition = effectParam;
      break;
    case 0xc: // set volume
      this.setVolume(effectParam);
      break;
    case 0xd: // jump to row in next pattern
      xm.nextPatternStartRow = effectParam;
      xm.nextSongPosition = xm.currentSongPosition + 1;
      break;
    case 0xf: // set panning
      this.setPanning(effectParam);
      break;
    default:
      /* TODO apply other channel effects */
  }
}

PlayingNote.prototype.setEnvelope = function() {
  for (var i = 0; i < this.inst.volumeEnvelope.length; i++) {
    var targetTime =
      this.startTime + this.inst.volumeEnvelope[i][0] * 2.5 / xm.currentBPM;
    if (targetTime >= actx.currentTime) {
      this.envelopeNode.gain.linearRampToValueAtTime(
	this.inst.volumeEnvelope[i][1] / 64,
	targetTime
      );
    }
  }
}

PlayingNote.prototype.setVolume = function(volume, defaultVolume) {
  var volumeFraction = 1;
  if (defaultVolume !== undefined) {
    volumeFraction = defaultVolume / 0x40;
  }
  if (volume >= 0x10 && volume <= 0x50) {
    volumeFraction = (volume - 0x10) / 0x40;
  } // TODO volume effects (or at least don't reset to 1 for volume > 0x50)
  this.volumeNode.gain.value = volumeFraction;
}

PlayingNote.prototype.setPanning = function(panning) {
  this.panningNode.pan.value = (panning - 128) / 128;
}

PlayingNote.prototype.stop = function(when) {
  if (when === undefined || when < actx.currentTime) {
    when = actx.currentTime;
  }
  // avoid clicks at note ends
  // FIXME magic constants not specified anywhere in the XM spec
  this.volumeNode.gain.setTargetAtTime(0, when, 0.1);
  this.bs.stop(when+0.2);
}

XMReader.prototype.playNote = function(note, channel) {
  new PlayingNote(note, this, channel);
}

XMReader.prototype.playRow = function(row) {
  for (var i = 0; i < row.length; i++) {
    this.playNote(row[i], i);
  }
}

var lastLag = 0;

// call fn(startTime+delay) at time startTime+delay, or immediately if that has already passed
function afterDelay(startTime, delay, fn) {
  var endTime = startTime + delay;
  if (actx.currentTime >= endTime) {
    if (actx.currentTime > lastLag + 10) {
      console.log('WARNING: lag');
      lastLag = actx.currentTime;
    }
    fn(endTime);
  } else {
    var bs = actx.createBufferSource();
    bs.buffer = actx.createBuffer(1,2,22050);
    bs.loop = true;
    bs.onended = fn.bind(this, endTime);
    bs.connect(actx.destination); // Chrome needs this
    bs.start();
    bs.stop(endTime);
  }
}

function highlightAndCenterRow(patternIndex, rowIndex) {
  var rowID = 'pattern-' + patternIndex + '-row-' + rowIndex;
  // scroll the row to the center of the view
  var rowElement =
    document.getElementById(rowID);
  rowElement.scrollIntoView(true);
  scrollBy(0, -(document.documentElement.clientHeight - rowElement.clientHeight) / 2);
  // make sure it's highlighted (not 'display: none')
  rowHighlight.style.display = '';
}

// return the current duration of one tick in seconds
XMReader.prototype.tickDuration = function() {
  return 2.5 / this.currentBPM;
}

// return the current duration of one pattern row in seconds
XMReader.prototype.rowDuration = function() {
  return this.currentTempo * this.tickDuration();
}

var stopPlease = false;

XMReader.prototype.playPattern = function(pattern, patternIndex, startRow, onEnded, loop, startTime) {
  if (stopPlease) {
    // stop showing row highlight
    rowHighlight.style.display = 'none';
    if (onEnded !== undefined) {
      onEnded.call();
    }
    return;
  }
  if (startRow === undefined) { startRow = 0; }
  if (startTime === undefined) { startTime = actx.currentTime; }
  if (this.nextSongPosition !== undefined) { startRow = pattern.length; }
  if (startRow < pattern.length) {
    // update display
    highlightAndCenterRow(patternIndex, startRow);
    // play all the notes/commands in the row
    this.playRow(pattern[startRow]);
    // delay one row (in seconds)
    var delay = this.rowDuration();
    // recurse on next row
    afterDelay(startTime, delay, this.playPattern.bind(this, pattern, patternIndex, startRow+1, onEnded, loop));
  } else if (loop) {
    this.playPattern(pattern, patternIndex, 0, onEnded, loop, startTime);
  } else { // after last row
    // stop showing row highlight
    rowHighlight.style.display = 'none';
    if (onEnded !== undefined) {
      onEnded.call();
    }
  }
}

XMReader.prototype.stopAllChannels = function() {
  this.nextSongPosition = undefined;
  this.nextPatternStartRow = undefined;
  for (var i = 0; i < this.channels.length; i++) {
    if (this.channels[i] !== undefined) {
      this.channels[i].stop();
      this.channels[i] = undefined;
    }
  }
}

window.stopPlaying = function() {
  // set stopPlease to make sure onended callbacks don't start new stuff
  stopPlease = true;
  if (xm !== undefined) { xm.stopAllChannels(); }
  // after all the onended callbacks have run, reset stopPlease
  setTimeout(function() { stopPlease = false; }, 500);
}

XMReader.prototype.playSong = function(startIndex, onEnded, loop) {
  if (stopPlease) {
    if (onEnded !== undefined) {
      onEnded.call();
    }
    return;
  }
  if (startIndex === undefined) { startIndex = 0; }
  if (startIndex == 0) {
    this.currentTempo = this.defaultTempo;
    this.currentBPM = this.defaultBPM;
  }
  if (this.nextSongPosition !== undefined) {
    startIndex = this.nextSongPosition;
    this.nextSongPosition = undefined;
  }
  if (startIndex < this.patternOrder.length) {
    this.currentSongPosition = startIndex;
    var startRow = 0;
    if (this.nextPatternStartRow !== undefined) {
      startRow = this.nextPatternStartRow;
      this.nextPatternStartRow = undefined;
    }
    this.playPattern(
      this.patterns[this.patternOrder[startIndex]],
      this.patternOrder[startIndex],
      startRow,
      this.playSong.bind(this, startIndex+1, onEnded, loop)
    );
  } else if (loop) {
    this.playSong(0, onEnded, loop);
  } else { // after last pattern
    this.stopAllChannels();
    if (onEnded !== undefined) {
      onEnded.call();
    }
  }
}

var xm;

function clearSong() {
  songDiv.style.display = 'none';
  songTable.innerHTML = '';
  patternOrderDiv.innerHTML = 'Pattern order: ';
  patternsDiv.innerHTML = '';
  instrumentsDiv.innerHTML = '';
  if (xm !== undefined) {
    xm.masterVolume.disconnect();
    xm = undefined;
  }
}

function readFile(file) {
  clearSong();
  xm = new XMReader(file);
  xm.onload = function() {
    xm.drawSong();
    console.log("successfully loaded file");
    songDiv.style.display = '';
  }
}

function fetchUrlAndRead(url) {
  console.log('fetching XM file from URL: ' + url);
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'blob';
  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE && xhr.status === 200) {
      console.log('fetched, reading');
      readFile(xhr.response);
    } // TODO handle HTTP errors
  }
  xhr.send();
}

function onInputFileChange(evt) {
  readFile(evt.target.files[0]);
}

function onFetch(evt) {
  fetchUrlAndRead(xmUrlInput.value);
}
