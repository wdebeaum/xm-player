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

var songTable;
var patternOrderDiv;
var patternsDiv;
var instrumentsDiv;
function onBodyLoad() {
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
  var that = this;
  this.binaryReader.onload = function() { return that.onBinaryLoad(); };
}

XMReader.prototype.onBinaryLoad = function() {
  this.readSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    patternsDiv.innerHTML += '<h3>Pattern ' + pi + '</h3>';
    this.readPattern();
  }
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
    //instrumentsDiv.innerHTML += '<h3>Instrument ' + (ii+1) + '</h3>';
    var h = document.createElement('h3');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Instrument ' + (ii+1)));
    this.readInstrument();
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
  songTable.innerHTML += '<tr><td>Song length:</td><td>' + this.songLength + '<td></tr>';
  var restartPosition = r.readUint16();
  songTable.innerHTML += '<tr><td>Restart position:</td><td>' + restartPosition + '</td></tr>';
  this.numberOfChannels = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of channels:</td><td>' + this.numberOfChannels + '</td></tr>';
  this.numberOfPatterns = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of patterns:</td><td>' + this.numberOfPatterns + '</td></tr>';
  this.numberOfInstruments = r.readUint16();
  songTable.innerHTML += '<tr><td>Number of instruments:</td><td>' + this.numberOfInstruments + '</td></tr>';
  var flags = r.readUint16();
  songTable.innerHTML += '<tr><td>Frequency table:</td><td>' + ((flags & 1) ? 'Linear' : 'Amiga') + '</td></tr>';
  var defaultTempo = r.readUint16();
  songTable.innerHTML += '<tr><td>Default tempo:</td><td>' + defaultTempo + '<td></tr>';
  var defaultBPM = r.readUint16();
  songTable.innerHTML += '<tr><td>Default BPM:</td><td>' + defaultBPM + '<td></tr>';
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

XMReader.prototype.readInstrument = function() {
  var r = this.binaryReader;
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
    var sampleNumberForAllNotes = r.readIntegers(96, false, 1, true);
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
    // vibrato
    var vibratoType = r.readUint8();
    var vibratoSweep = r.readUint8();
    var vibratoDepth = r.readUint8();
    var vibratoRate = r.readUint8();
    // other
    var volumeFadeout = r.readUint16();
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
  for (var si = 0; si < numberOfSamples; si++) {
    samples.push(this.readSampleHeader());
    /*instrumentsDiv.innerHTML += '<h4>Sample ' + si + '</h4>';
    instrumentsDiv.innerHTML += 'Name: ' + samples[si].name.encodeHTML() + '<br>';*/
    var h = document.createElement('h4');
    instrumentsDiv.appendChild(h);
    h.appendChild(document.createTextNode('Sample ' + si));
    instrumentsDiv.appendChild(document.createTextNode('Name: ' + samples[si].name));
    instrumentsDiv.appendChild(document.createElement('br'));
  }
  for (var si = 0; si < numberOfSamples; si++) {
    this.readSampleData(samples[si]);
  }
}

XMReader.prototype.readSampleHeader = function() {
  var r = this.binaryReader;
  var s = {};
  s.lengthInBytes = r.readUint32();
  var sampleLoopStart = r.readUint32();
  var sampleLoopLength = r.readUint32();
  var volume = r.readUint8();
  var finetune = r.readIntegers(1, true, 1, true)[0];
  var type = r.readUint8();
  s.bytesPerSample = ((type & (1<<4)) ? 2 : 1);
  console.log('bytesPerSample = ' + s.bytesPerSample);
  var panning = r.readUint8();
  console.log('panning=' + panning);
  var relativeNoteNumber = r.readIntegers(1, true, 1, true)[0];
  console.log('relativeNoteNumber=' + relativeNoteNumber);
  var reserved = r.readUint8();
  s.name = r.readZeroPaddedString(22);
  console.log('name=' + s.name);
  // TODO
  return s;
}

XMReader.prototype.readSampleData = function(s) {
  var deltas = this.binaryReader.readIntegers(s.lengthInBytes / s.bytesPerSample, true, s.bytesPerSample, true);
  var values = [];
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
    var scaled = 128 + Math.trunc(values[i]/256);
    if (scaled < min) { min = scaled; }
    if (scaled > max) { max = scaled; }
    if ((i % horizDivisor) == 0) {
      //console.log('i=' + i + '; min=' + min + '; max=' + max);
      ctx.fillRect(Math.floor(i/horizDivisor), min, 1, max-min+1);
      min = 256;
      max = 0;
    }
  }
}

function onInputFileChange(evt) {
  var file = evt.target.files[0];
  var xm = new XMReader(file);
  xm.onload = function() { console.log("successfully loaded file"); };
}
