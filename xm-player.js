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

function XM(file) {
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

XM.prototype.onBinaryLoad = function() {
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

XM.prototype.drawSong = function() {
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

XM.prototype.readSongHeader = function() {
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

XM.prototype.drawSongHeader = function() {
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

XM.prototype.readPattern = function(pi) {
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

XM.prototype.drawPattern = function(pi) {
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

XM.prototype.readInstrument = function() {
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

XM.prototype.drawInstrument = function(ii) {
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

XM.prototype.interpretVolumePanning = function(ret, volumeOrPanning, points, numberOfPoints, sustainPoint, loopStartPoint, loopEndPoint, type) {
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

XM.prototype.drawVolumePanning = function(ret, volumeOrPanning) {
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

XM.prototype.readSampleHeader = function() {
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

XM.prototype.drawSampleHeader = function(s) {
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

XM.prototype.readSampleData = function(s) {
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

XM.prototype.drawSampleData = function(s) {
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
XM.prototype.portaToPlaybackRateFactor = function(effectParam) {
  return Math.pow(2, effectParam * this.currentTempo / (16*12));
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

XM.prototype.playNote = function(note, channel) {
  this.channels[channel].applyCommand(actx.currentTime /*FIXME*/, note);
}

XM.prototype.playRow = function(row) {
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
XM.prototype.tickDuration = function() {
  return 2.5 / this.currentBPM;
}

// return the current duration of one pattern row in seconds
XM.prototype.rowDuration = function() {
  return this.currentTempo * this.tickDuration();
}

var stopPlease = false;

XM.prototype.playPattern = function(pattern, patternIndex, startRow, onEnded, loop, startTime) {
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

XM.prototype.stopAllChannels = function() {
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

XM.prototype.playSong = function(startIndex, onEnded, loop) {
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
  xm = new XM(file);
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
