var songTable;
var patternOrderDiv;
function onBodyLoad() {
  songTable = document.getElementById('song');
  patternOrderDiv = document.getElementById('pattern-order-table');
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
  return String.fromCharCode.apply(String, codes);
};

function XMReader(file) {
  this.binaryReader = new BinaryFileReader(file);
  var that = this;
  this.binaryReader.onload = function() { return that.onload(); };
}

XMReader.prototype.onBinaryLoad = function() {
  this.readSongHeader();
  for (var pi = 0; pi < this.numberOfPatterns; pi++) {
    this.readPattern();
  }
  for (var ii = 0; ii < this.numberOfInstruments; ii++) {
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
  songTable.innerHTML += '<tr><td>Module name:</td><td>' + moduleName + '</td></tr>';
  var magic = r.readUint8();
  if (magic != 0x1a) {
    throw new Error('wrong magic byte: ' + magic);
  }
  var trackerName = r.readZeroPaddedString(20);
  songTable.innerHTML += '<tr><td>Tracker name:</td><td>' + trackerName + '</td></tr>';
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
  var packingType = r.readUint8();
  var numberOfRows = r.readUint16();
  var packedPatternDataSize = r.readUint16();
  var packedPatternData = r.readIntegers(packedPatternDataSize, false, 1, true);
  // TODO unpack and write to #patterns
}

XMReader.prototype.readInstrument = function() {
  var r = this.binaryReader;
  var instrumentHeaderSize = r.readUint16();
  var instrumentName = r.readZeroPaddedString(22);
  var instrumentType = r.readUint8();
  var numberOfSamples = r.readUint16();
  if (instrumentHeaderSize >= 243) {
    var sampleHeaderSize = r.readUint16();
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
      r.readIntegers(instrumentHeaderSize - 243, false, 1, true);
    }
  } else if (instrumentHeaderSize > 29) {
    r.readIntegers(instrumentHeaderSize - 29, false, 1, true);
  }
  var samples = [];
  for (var si = 0; si < numberOfSamples; si++) {
    samples.push(this.readSampleHeader());
  }
  for (var si = 0; si < numberOfSamples; si++) {
    this.readSampleData(samples[si]);
  }
  // TODO write to #instruments
}

XMReader.prototype.readSampleHeader = function() {
  var r = this.binaryReader;
  var s = {};
  s.lengthInBytes = r.readUint16();
  var sampleLoopStart = r.readUint16();
  var sampleLoopLength = r.readUint16();
  var volume = r.readUint8();
  var finetune = r.readIntegers(1, true, 1, true)[0];
  var type = r.readUint8();
  s.bytesPerSample = ((type & (1<<4)) ? 2 : 1);
  var panning = r.readUint8();
  var relativeNoteNumber = r.readIntegers(1, true, 1, true)[0];
  var reserved = r.readUint8();
  var sampleName = r.readZeroPaddedString(22);
  // TODO
  return s;
}

XMReader.prototype.readSampleData = function(s) {
  var deltas = this.binaryReader.readIntegers(s.lengthInBytes / s.bytesPerSample, true, s.bytesPerSample, true);
  // TODO
}

function onInputFileChange(evt) {
  var file = evt.target.files[0];
  var xm = new XMReader(file);
  xm.onload = function() { console.log("successfully loaded file"); };
}
