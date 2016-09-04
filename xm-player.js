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
var showPatternsInput;
var xmUrlInput;
var songDiv;
var songTable;
var patternOrderDiv;
var patternsDiv;
var instrumentsDiv;
var rowHighlight;
function onBodyLoad() {
  actx = new AudioContext();
  showPatternsInput = document.getElementById('show-patterns');
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
  this.masterVolume.gain.value = 0.2;
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
  if (showPatternsInput.checked) {
    for (var pi = 0; pi < this.numberOfPatterns; pi++) {
      this.drawPattern(pi);
    }
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
  for (var ci = 0; ci < this.numberOfChannels; ci++) {
    this.channels[ci] = new Channel(this);
  }
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
    table += '<tr id="pattern-' + pi + '-row-' + ri + '" class="row-' + (ri % 8) + '"><td class="row-num">' + ri.toString(16) + '</td>';
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
  if (ret.volumeFadeout > 0) {
    appendLine(instrumentsDiv, 'Volume fadeout: reduce volume by ' + ret.volumeFadeout + ' / 65536 of what it would be otherwise, per tick after note release');
  }
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
    svg.setAttribute('viewBox', '0 0 192 64');
    svg.setAttribute('width',384);
    svg.setAttribute('height',128);
    instrumentsDiv.appendChild(svg);
    var bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x',0);
    bg.setAttribute('y',0);
    bg.setAttribute('width',192);
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
  var maxint = (1 << (8*s.bytesPerSample));
  var maxsint = (maxint>>1)-1;
  var minsint = -(maxint>>1);
  var old = 0;
  for (var i = 0; i < deltas.length; i++) {
    var neww = old + deltas[i];
    // discard overflow
    if (neww > maxsint) {
      neww -= maxint;
    } else if (neww < minsint) {
      neww += maxint;
    }
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
  if (instrumentNum > 0) {
    this.instrument = xm.instruments[instrumentNum-1];
  }
  this.sample = this.instrument.samples[this.instrument.sampleNumberForAllNotes[noteNum]];
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
    default:
      /* TODO apply other global effects */
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
      if (hi) { // up
        this.volumeSlide(when, true, (hi<<2));
      } else { // down
        this.volumeSlide(when, false, (lo<<2));
      }
      break;
    case 0x6: // vibrato and volume slide
      this.triggerVibrato(when);
      if (hi) { // up
        this.volumeSlide(when, true, (hi<<2));
      } else { // down
        this.volumeSlide(when, false, (lo<<2));
      }
      break;
    case 0x7: break; // TODO tremolo
    case 0x8: // set panning
      this.setPanning(when, effectParam);
      break;
    case 0x9: break; // TODO sample offset
    case 0xa: // volume slide
      if (hi) { // up
        this.volumeSlide(when, true, (hi<<2));
      } else { // down
        this.volumeSlide(when, false, (lo<<2));
      }
      break;
    case 0xb: // jump to song position
      this.xm.nextSongPosition = effectParam;
      break;
    case 0xc: // set volume
      this.setVolume(when, effectParam);
      break;
    case 0xd: // jump to row in next pattern
      this.xm.nextPatternStartRow = effectParam;
      this.xm.nextSongPosition = xm.currentSongPosition + 1;
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

/* Set the actual note volume (not the volume column, not the envelope). */
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

function volumeSlide(when, up, rate) {
  // FIXME how does this interact with instrument volume fadeout?
  var duration = this.xm.rowDuration();
  var oldVolume = this.volume;
  var newVolume = oldVolume + (up ? -1 : 1) * rate * this.xm.currentTempo;
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
  if (this.notePhase != 'off') {
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
    this.vibratoAmplitudeNode.linearRampToValueAtTime(gain, sweepEndTime);
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

XMReader.prototype.playNote = function(note, channel) {
  this.channels[channel].applyCommand(actx.currentTime /*FIXME*/, note);
}

XMReader.prototype.playRow = function(row) {
  for (var i = 0; i < row.length; i++) {
    this.playNote(row[i], i);
  }
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
    if (showPatternsInput.checked) { rowHighlight.style.display = 'none'; }
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
    if (showPatternsInput.checked) {
      highlightAndCenterRow(patternIndex, startRow);
    }
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
    if (showPatternsInput.checked) { rowHighlight.style.display = 'none'; }
    if (onEnded !== undefined) {
      onEnded.call();
    }
  }
}

XMReader.prototype.stopAllChannels = function() {
  this.nextSongPosition = undefined;
  this.nextPatternStartRow = undefined;
  for (var i = 0; i < this.channels.length; i++) {
    this.channels[i].cutNote();
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
