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
    return '---';
  } else if (num > 97) {
    return 'err';
  } else {
    num--;
    return '' + noteLetters[num % 12] + Math.floor(num / 12);
  }
}

// FIXME assumes linear frequency table
function computePlaybackRate(noteNum, relNoteNum, fineTune) {
  /* this is the formula from the "spec", but it seems weird and wrong
  var period = 10*12*16*4 - (noteNum + relNoteNum)*16*4 - fineTune/2;
  console.log('period=' + period);
  var frequency = 8363*Math.pow(2, (6*12*16*4 - period) / (12*16*4));
  console.log('frequency=' + frequency);
  // weird divisor
  return frequency/22050;*/
  // this is from principles
  return Math.pow(2, (noteNum + relNoteNum - 48/*C-4*/ + fineTune/128)/12)
  // according to a1k0n, I should multiply a factor of 8363Hz/44100Hz in here, but I'm not so sure
}

var actx;
// HTML elements
var songTable;
var patternOrderDiv;
var patternsDiv;
var instrumentsDiv;
function onBodyLoad() {
  actx = new AudioContext();
  songTable = document.getElementById('song');
  patternOrderDiv = document.getElementById('pattern-order-table');
  patternsDiv = document.getElementById('patterns');
  instrumentsDiv = document.getElementById('instruments');
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
  this.binaryReader = new BinaryFileReader(file);
  this.channels = [];
  var that = this;
  this.binaryReader.onload = function() { return that.onBinaryLoad(); };
}

XMReader.prototype.onBinaryLoad = function() {
  this.readSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    patternsDiv.innerHTML += '<h3>Pattern ' + pi + '</h3>';
    this.readPattern();
  }
  this.instruments = [];
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
    //instrumentsDiv.innerHTML += '<h3>Instrument ' + (ii+1) + '</h3>';
    var h = document.createElement('h3');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Instrument ' + (ii+1)));
    this.instruments.push(this.readInstrument());
  }
  console.log(this);
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
  songTable.innerHTML += '<tr><td>Default tempo:</td><td>' + this.defaultTempo + ' ticks per row<td></tr>';
  this.defaultBPM = r.readUint16();
  songTable.innerHTML += '<tr><td>Default BPM:</td><td>' + this.defaultBPM + ' (' + (this.defaultBPM/2.5) + ' ticks per second)<td></tr>';
  var patternOrder = r.readIntegers(256, false, 1, true);
  for (var i = 0; i < this.songLength; i++) {
    patternOrderDiv.innerHTML += ((i==0) ? '' : ', ') + patternOrder[i];
  }
}

XMReader.prototype.readPattern = function() {
  var r = this.binaryReader;
  var patternHeaderLength = r.readUint32();
  if (patternHeaderLength != 9) { console.log('WARNING: wrong pattern header length'); }
  var packingType = r.readUint8();
  if (packingType != 0) { console.log('WARNING: wrong packing type'); }
  var numberOfRows = r.readUint16();
  if (numberOfRows == 0) { console.log('WARNING: no rows'); }
  if (numberOfRows > 256) { console.log('WARNING: too many rows'); }
  patternsDiv.innerHTML += 'Number of rows: ' + numberOfRows;
  var packedPatternDataSize = r.readUint16();
  var packedPatternData = r.readIntegers(packedPatternDataSize, false, 1, true);
  // unpack and write to #patterns
  patternsDiv.innerHTML += '<h4>Pattern data</h4>';
  var table = '<table><tr>';
  var ci;
  for (ci = 0; ci < this.numberOfChannels; ci++) {
    table += '<th>Not</th><th>In</th><th>Vl</th><th>ET</th><th>EP</th>';
  }
  table += '</tr>';
  var pdi = 0;
  ci = 0;
  var actualNumberOfRows = 0;
  while (pdi < packedPatternData.length) {
    if (ci == 0) {
      table += '<tr>';
    }
    if (packedPatternData[pdi] & 0x80) {
      var col = packedPatternData[pdi++];
      table += '<td class="note">';
      if (col & 1) {
	table += noteNumberToName(packedPatternData[pdi++]);
      } else {
	table += '---';
      }
      table += '</td>';
      for (var x = 1; x < 5; x++) {
	table += '<td>';
	if (col & (1 << x)) {
	  table += packedPatternData[pdi++].toString(16);
	} else {
	  table += '--';
	}
	table += '</td>';
      }
    } else {
      table += '<td class="note">' + noteNumberToName(packedPatternData[pdi++]) + '</td>';
      for (var x = 1; x < 5; x++) {
	table += '<td>' + packedPatternData[pdi++].toString(16) + '</td>';
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
    console.log('WARNING: wrong number of rows: expected ' + numberOfRows + ' but got ' + actualNumberOfRows);
  }
  if (ci != 0) {
    console.log('WARNING: number of notes not divisible by number of channels');
  }
  table += '</table>';
  patternsDiv.innerHTML += table;
}

var vibratoTypes = ['sine', 'square', 'saw down', 'saw up'];

XMReader.prototype.readInstrument = function() {
  var r = this.binaryReader;
  var ret = {};
  var instrumentHeaderSize = r.readUint32();
  if (instrumentHeaderSize < 29) {
    console.log('WARNING: instrument header size too small: ' + instrumentHeaderSize);
  }
  //instrumentsDiv.innerHTML += 'Header size: ' + instrumentHeaderSize + '<br>';
  instrumentsDiv.appendChild(document.createTextNode('Header size: ' + instrumentHeaderSize));
  instrumentsDiv.appendChild(document.createElement('br'));
  var instrumentName = r.readZeroPaddedString(22);
  //instrumentsDiv.innerHTML += 'Name: ' + instrumentName.encodeHTML() + '<br>';
  instrumentsDiv.appendChild(document.createTextNode('Name: ' + instrumentName));
  instrumentsDiv.appendChild(document.createElement('br'));
  var instrumentType = r.readUint8();
  if (instrumentType != 0) { console.log('WARNING: nonzero instrument type'); }
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
      console.log('' + instrumentHeaderSize + ' - 243 = ' + count);
      r.readIntegers(count, false, 1, true);
    }
  } else if (instrumentHeaderSize > 29) {
    r.readIntegers(instrumentHeaderSize - 29, false, 1, true);
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
  console.log('name=' + s.name);
  return s;
}

var loopTypes = ['none', 'forward', 'ping-pong'];

XMReader.prototype.drawSampleHeader = function(s) {
  var table = document.createElement('table');
  instrumentsDiv.appendChild(table);
  table.innerHTML =
    '<tr><td>Name:</td><td>' + s.name + '</td></tr>' +
    '<tr><td>Relative note number:</td><td>' + s.relativeNoteNumber + '</td></tr>' +
    '<tr><td>Finetune:</td><td>' + s.finetune + '</td></tr>' +
    '<tr><td>Volume:</td><td>' + s.volume + '</td></tr>' +
    '<tr><td>Panning:</td><td>' + s.panning + '</td></tr>';
  if (s.loopType) {
    table.innerHTML +=
      '<tr><td>Loop:</td><td>' + loopTypes[s.loopType] + ' ' + s.loopStart + '-' + (s.loopLength + s.loopStart) + '</td></tr>';
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
  var play = document.createElement('a');
  play.appendChild(document.createTextNode('▶'));
  instrumentsDiv.appendChild(play);
  play.onclick = function() {
    console.log('playing sample');
    var bs = sampleDataToBufferSource(s.data, s.bytesPerSample);
    bs.playbackRate = computePlaybackRate(64, s.relativeNoteNumber, s.finetune);
    bs.connect(actx.destination);
    bs.start();
    console.log(bs);
  };
}

function sampleDataToBufferSource(data, bytesPerSample) {
  var bs = actx.createBufferSource();
  var buffer = actx.createBuffer(1, data.length, 44100);
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

XMReader.prototype.playNote = function(noteNum, instrumentNum, volume) {
  var inst = this.instruments[instrumentNum];
  var sampleNum = inst.sampleNumberForAllNotes[noteNum];
  var samp = inst.samples[sampleNum];
  var bs = sampleDataToBufferSource(samp.data, samp.bytesPerSample);
  bs.playbackRate = computePlaybackRate(noteNum, samp.relativeNoteNumber, samp.finetune);
  if ('volumeEnvelope' in inst) {
    var gain = actx.createGain();
    for (var i = 0; i < inst.volumeEnvelope.length; i++) {
      gain.gain.linearRampToValueAtTime(inst.volumeEnvelope[1]/64, actx.currentTime + inst.volumeEnvelope[0] * 2.5 / this.defaultBPM);
    }
  } else {
    bs.connect(actx.destination);
  }
  bs.start();
  // TODO loop, stopping when envelop reaches 0?
}

function onInputFileChange(evt) {
  var file = evt.target.files[0];
  var xm = new XMReader(file);
  xm.onload = function() { console.log("successfully loaded file"); };
}
