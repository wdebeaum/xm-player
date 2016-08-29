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
  //console.log('song header')
  this.readSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    //console.log('pattern ' + pi);
    //patternsDiv.innerHTML += '<h3>Pattern ' + pi + '</h3>';
    var h = document.createElement('h3');
    patternsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Pattern ' + pi));
    this.readPattern(pi);
  }
  this.instruments = [];
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
    //console.log('instrument ' + ii);
    //instrumentsDiv.innerHTML += '<h3>Instrument ' + (ii+1) + '</h3>';
    var h = document.createElement('h3');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Instrument ' + (ii+1).toString(16)));
    var play = document.createElement('button');
    play.appendChild(document.createTextNode('▶'));
    instrumentsDiv.appendChild(play);
    instrumentsDiv.appendChild(document.createElement('br'));
    play.onclick = this.playNote.bind(this, [65, ii+1, 0,0,0], 0);
    this.instruments.push(this.readInstrument());
  }
  //console.log('done reading');
  console.log(this);
  if ('onload' in this) {
    this.onload();
  }
}

XMReader.prototype.readSongHeader = function() {
  var r = this.binaryReader;
  var idText = r.readZeroPaddedString(17);
  if (idText != 'Extended Module: ') {
    throw new Error('wrong ID text: ' + idText);
  }
  var moduleName = r.readZeroPaddedString(20);
  songTable.innerHTML += '<tr><td>Module name:</td><td>' + moduleName.encodeHTML() + '</td></tr>';
  var magic = r.readUint8();
  if (magic != 0x1a) {
    throw new Error('wrong magic byte: ' + magic);
  }
  var trackerName = r.readZeroPaddedString(20);
  songTable.innerHTML += '<tr><td>Tracker name:</td><td>' + trackerName.encodeHTML() + '</td></tr>';
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
  songTable.innerHTML += '<tr><td>Song length:</td><td>' + this.songLength + ' patterns<td></tr>';
  var restartPosition = r.readUint16();
  songTable.innerHTML += '<tr><td>Restart position:</td><td>pattern ' + restartPosition + ' in pattern order</td></tr>';
  this.numberOfChannels = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of channels:</td><td>' + this.numberOfChannels + '</td></tr>';
  this.numberOfPatterns = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of patterns:</td><td>' + this.numberOfPatterns + '</td></tr>';
  this.numberOfInstruments = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of instruments:</td><td>' + this.numberOfInstruments + '</td></tr>';
  var flags = r.readUint16();
  songTable.innerHTML += '<tr><td>Frequency table:</td><td>' + ((flags & 1) ? 'Linear' : 'Amiga') + '</td></tr>';
  this.defaultTempo = r.readUint16();
  this.currentTempo = this.defaultTempo;
  songTable.innerHTML += '<tr><td>Default tempo:</td><td>' + this.defaultTempo + ' ticks per row<td></tr>';
  this.defaultBPM = r.readUint16();
  this.currentBPM = this.defaultBPM;
  songTable.innerHTML += '<tr><td>Default BPM:</td><td>' + this.defaultBPM + ' (' + (this.defaultBPM/2.5) + ' ticks per second)<td></tr>';
  this.patternOrder = r.readIntegers(256, false, 1, true).slice(0,this.songLength);
  for (var i = 0; i < this.songLength; i++) {
    patternOrderDiv.innerHTML += ((i==0) ? '' : ', ') + this.patternOrder[i];
  }
}

var volumeEffectLetters = ['-', '+', '▼', '▲', 'S', 'V', 'P', '◀', '▶', 'M'];

function formatVolume(val) {
  if (val < 0x60) {
    return val.toString(16);
  } else {
    return volumeEffectLetters[(val>>4)-6] + (val&0xf).toString(16);
  }
}

function formatCell(x, cell) {
  switch (x) {
    case 2:
      return formatVolume(cell);
    case 3:
      return cell.toString(36);
    case 4:
      return ((cell < 0x10) ? '0' : '') + cell.toString(16);
    default:
      return cell.toString(16);
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
  //patternsDiv.innerHTML += 'Number of rows: ' + numberOfRows;
  patternsDiv.appendChild(document.createTextNode('Number of rows: ' + numberOfRows));
  var packedPatternDataSize = r.readUint16();
  var packedPatternData = r.readIntegers(packedPatternDataSize, false, 1, true);
  // unpack and write to #patterns
  //patternsDiv.innerHTML += '<h4>Pattern data</h4>';
  var h = document.createElement('h4');
  patternsDiv.appendChild(h);
  h.appendChild(document.createTextNode('Pattern data'));
  var table = '<tr><th>Rw</th>';
  var ci;
  for (ci = 0; ci < this.numberOfChannels; ci++) {
    table += '<th class="note">Not</th><th class="col-1">In</th><th class="col-2">Vl</th><th class="col-3">E</th><th class="col-4">Pr</th>';
  }
  table += '</tr>';
  var pat = [];
  this.patterns.push(pat);
  //patternsDiv.innerHTML +=
  //  '<a onclick="xm.playPattern(xm.patterns[' + (this.patterns.length-1) +'], ' + (this.patterns.length-1) + ')">▶</a><br>';
  var playButton = document.createElement('button');
  patternsDiv.appendChild(playButton);
  playButton.setAttribute('onclick', 'xm.playPattern(xm.patterns[' + (this.patterns.length-1) +'], ' + (this.patterns.length-1) + ')');
  playButton.appendChild(document.createTextNode('▶'));
  var loopButton = document.createElement('button');
  loopButton.setAttribute('onclick', 'xm.playPattern(xm.patterns[' + (this.patterns.length-1) +'], ' + (this.patterns.length-1) + ', 0, undefined, true)');
  patternsDiv.appendChild(loopButton);
  loopButton.appendChild(document.createTextNode('↺'));
  patternsDiv.appendChild(document.createElement('br'));
  var row;
  var pdi = 0;
  ci = 0;
  var actualNumberOfRows = 0;
  while (pdi < packedPatternData.length) {
    if (ci == 0) {
      table += '<tr id="pattern-' + pi + '-row-' + actualNumberOfRows + '" class="row-' + (actualNumberOfRows % 4) + '"><td class="row-num">' + actualNumberOfRows.toString(16) + '</td>';
      row = [];
      pat.push(row);
    }
    var note = [];
    row.push(note);
    if (packedPatternData[pdi] & 0x80) {
      var col = packedPatternData[pdi++];
      table += '<td class="note">';
      if (col & 1) {
        var noteNum = packedPatternData[pdi++];
	table += noteNumberToName(noteNum);
	note.push(noteNum);
      } else {
	table += '···';
	note.push(0);
      }
      table += '</td>';
      for (var x = 1; x < 5; x++) {
	table += '<td class="col-' + x + '">';
	if (col & (1 << x)) {
	  var cell = packedPatternData[pdi++]
	  table += formatCell(x, cell);
	  note.push(cell);
	} else {
	  // FIXME effect type column should show as '0' instead of '·' when parameter is nonzero, but we haven't gotten there yet
	  table += ((x==3) ? '·' : '··');
	  note.push(0);
	}
	table += '</td>';
      }
    } else {
      var noteNum = packedPatternData[pdi++];
      table += '<td class="note">' + noteNumberToName(noteNum) + '</td>';
      note.push(noteNum);
      for (var x = 1; x < 5; x++) {
	var cell = packedPatternData[pdi++];
	table += '<td class="col-' + x + '">' + formatCell(x, cell) + '</td>';
	note.push(cell);
      }
    }
    ci++;
    if (ci == this.numberOfChannels) {
      ci = 0;
      table += '</tr>';
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
  var tableElement = document.createElement('table');
  patternsDiv.appendChild(tableElement);
  tableElement.innerHTML = table;
}

var vibratoTypes = ['sine', 'square', 'saw down', 'saw up'];

XMReader.prototype.readInstrument = function() {
  var r = this.binaryReader;
  var ret = {};
  var instrumentHeaderSize = r.readUint32();
  if (instrumentHeaderSize < 29) {
    console.log('WARNING: instrument header size too small; expected >=29 but got ' + instrumentHeaderSize);
  }
  //instrumentsDiv.innerHTML += 'Header size: ' + instrumentHeaderSize + '<br>';
  instrumentsDiv.appendChild(document.createTextNode('Header size: ' + instrumentHeaderSize));
  instrumentsDiv.appendChild(document.createElement('br'));
  var instrumentName = r.readZeroPaddedString(22);
  //instrumentsDiv.innerHTML += 'Name: ' + instrumentName.encodeHTML() + '<br>';
  instrumentsDiv.appendChild(document.createTextNode('Name: ' + instrumentName));
  instrumentsDiv.appendChild(document.createElement('br'));
  var instrumentType = r.readUint8();
  if (instrumentType != 0) { console.log('WARNING: wrong instrument type; expected 0 but got 0x' + instrumentType.toString(16)); }
  var numberOfSamples = r.readUint16();
  if (instrumentHeaderSize >= 243) {
    var sampleHeaderSize = r.readUint32();
    //instrumentsDiv.innerHTML += 'Sample header size: ' + sampleHeaderSize + '<br>';
    instrumentsDiv.appendChild(document.createTextNode('Sample header size: ' + sampleHeaderSize));
    instrumentsDiv.appendChild(document.createElement('br'));
    ret.sampleNumberForAllNotes = r.readIntegers(96, false, 1, true);
    if (numberOfSamples > 1) {
      var snfan = 'Sample number for all notes:';
      for (var i = 0; i < 96; i++) {
	snfan += ' ' + ret.sampleNumberForAllNotes[i];
      }
      instrumentsDiv.appendChild(document.createTextNode(snfan));
      instrumentsDiv.appendChild(document.createElement('br'));
    }
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
    this.drawVolumePanning('Volume', pointsForVolumeEnvelope, numberOfVolumePoints, volumeSustainPoint, volumeLoopStartPoint, volumeLoopEndPoint, volumeType);
    if (volumeType & 1) {
      ret.volumeEnvelope = [];
      for (var i = 0; i < numberOfVolumePoints; i++) {
	ret.volumeEnvelope.push(pointsForVolumeEnvelope.slice(i*2,i*2+2));
      }
    }
    this.drawVolumePanning('Panning', pointsForPanningEnvelope, numberOfPanningPoints, panningSustainPoint, panningLoopStartPoint, panningLoopEndPoint, panningType);
    // vibrato
    var vibratoType = r.readUint8();
    var vibratoSweep = r.readUint8();
    var vibratoDepth = r.readUint8();
    var vibratoRate = r.readUint8();
    if (vibratoType || vibratoSweep || vibratoDepth || vibratoRate) {
      instrumentsDiv.appendChild(document.createTextNode('Vibrato: ' + vibratoTypes[vibratoType] + '(sweep=' + vibratoSweep + '; depth=' + vibratoDepth + '; rate=' + vibratoRate + ')'));
      instrumentsDiv.appendChild(document.createElement('br'));
    }
    // other
    var volumeFadeout = r.readUint16();
    instrumentsDiv.appendChild(document.createTextNode('Volume fadeout: ' + volumeFadeout));
    instrumentsDiv.appendChild(document.createElement('br'));
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
  var samples = [];
  ret.samples = samples;
  for (var si = 0; si < numberOfSamples; si++) {
    samples.push(this.readSampleHeader());
    /*instrumentsDiv.innerHTML += '<h4>Sample ' + si + '</h4>';
    instrumentsDiv.innerHTML += 'Name: ' + samples[si].name.encodeHTML() + '<br>';*/
    var h = document.createElement('h4');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Sample ' + si));
    /*instrumentsDiv.appendChild(document.createTextNode('Name: ' + samples[si].name));
    instrumentsDiv.appendChild(document.createElement('br'));*/
  }
  for (var si = 0; si < numberOfSamples; si++) {
    this.drawSampleHeader(samples[si]);
    this.readSampleData(samples[si]);
  }
  return ret;
}

var svgNS = 'http://www.w3.org/2000/svg';

XMReader.prototype.drawVolumePanning = function(volumeOrPanning, points, numberOfPoints, sustainPoint, loopStartPoint, loopEndPoint, type) {
  if (type & 1) { // On
    var h = document.createElement('h4');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode(volumeOrPanning));
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
    for (var i = 0; i < numberOfPoints; i++) {
      path += (i == 0 ? 'M ' : ' L ') + points[i*2] + ' ' + (64-points[i*2+1]);
    }
    p.setAttribute('d', path);
    svg.appendChild(p);
    instrumentsDiv.appendChild(document.createElement('br'));
    if (type & 2) { // Sustain
      instrumentsDiv.appendChild(document.createTextNode('Sustain point: ' + sustainPoint));
      instrumentsDiv.appendChild(document.createElement('br'));
    }
    if (type & 4) { // Loop
      instrumentsDiv.appendChild(document.createTextNode('Loop: ' + loopStartPoint + '-' + loopEndPoint));
      instrumentsDiv.appendChild(document.createElement('br'));
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
  var values = [];
  s.data = values;
  var old = 0;
  for (var i = 0; i < deltas.length; i++) {
    var neww = old + deltas[i];
    // discard overflow
    neww %= (1 << (8*s.bytesPerSample));
    values.push(neww);
    old = neww;
  }
  // draw waveform on a canvas
  var canvas = document.createElement('canvas');
  canvas.setAttribute('height', 256);
  var horizDivisor = Math.floor(values.length / 512);
  if (horizDivisor == 0) { horizDivisor = 1; }
  canvas.setAttribute('width', 512);
  instrumentsDiv.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  var min = 256;
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var scaled = 128 + ((s.bytesPerSample == 2) ? Math.trunc(values[i]/256) : values[i]);
    if (scaled < min) { min = scaled; }
    if (scaled > max) { max = scaled; }
    if ((i % horizDivisor) == 0) {
      //console.log('i=' + i + '; min=' + min + '; max=' + max);
      ctx.fillRect(Math.floor(i/horizDivisor), min, 1, max-min+1);
      min = 256;
      max = 0;
    }
  }
  instrumentsDiv.appendChild(document.createElement('br'));
  var play = document.createElement('button');
  play.appendChild(document.createTextNode('▶'));
  instrumentsDiv.appendChild(play);
  play.onclick = function() {
    var bs = sampleDataToBufferSource(s.data, s.bytesPerSample);
    // TODO apply sample volume (0-64), panning (left 0 - right 255)
    bs.playbackRate = computePlaybackRate(64, s.relativeNoteNumber, s.finetune);
    bs.connect(xm.masterVolume);
    bs.start();
  };
}

// return the factor to multiply (porta up) or divide (porta down) the playback
// rate by for an entire row (not just one tick) for the given effect parameter
// value
// effectParam is in 16ths of a semitone per tick
XMReader.prototype.portaToPlaybackRateFactor = function(effectParam) {
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
  this.setVolume(volume);
  this.volumeNode.connect(xm.masterVolume);
  this.panningNode = actx.createStereoPanner();
  this.setPanning(samp.panning);
  this.panningNode.connect(this.volumeNode);
  this.bs = sampleDataToBufferSource(samp.data, samp.bytesPerSample);
  var pbr = computePlaybackRate(noteNum, samp.relativeNoteNumber, samp.finetune);
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
  var oldPbr = this.bs.playbackRate.value;
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

PlayingNote.prototype.setVolume = function(volume) {
  var volumeFraction = 1;
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
  if (startIndex < this.patternOrder.length) {
    this.playPattern(
      this.patterns[this.patternOrder[startIndex]],
      this.patternOrder[startIndex],
      0,
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
