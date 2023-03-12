// first some HTML-building support consts/functions

const svgNS = 'http://www.w3.org/2000/svg';
const noteLetters = 'C- C# D- D# E- F- F# G- G# A- A# B-'.split(' ');
const volumeEffectLetters = '- + ▼ ▲ S V P ◀ ▶ M'.split(' ');
const vibratoTypes = 'sine square saw down saw up'.split(' ');
const loopTypes = 'none forward ping-pong'.split(' ');

if (!String.prototype.encodeHTML) {
  String.prototype.encodeHTML = function() {
    return this.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&apos;');
  };
}

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

function appendHeading(parentNode, level, text) {
  const h = document.createElement('h' + level);
  h.appendChild(document.createTextNode(text));
  parentNode.appendChild(h);
}

// onclick may be a string to put in the onclick attribute, or a function to
// assign to the onclick property
function appendButton(parentNode, label, onclick) {
  const button = document.createElement('button');
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

function formatVolume(val) {
  if (val == 0) {
    return '··';
  } else if (val < 0x60) {
    return val.toString(16);
  } else {
    return volumeEffectLetters[(val>>4)-6] + (val&0xf).toString(16);
  }
}

/* exported XM */
/** The XM class is for reading and displaying XM file data. */
class XM {
  constructor(file) {
    this.masterVolume = actx.createGain();
    this.masterVolume.connect(actx.destination);
    this.resetVolume();
    this.binaryReader = new BinaryFileReader(file);
    this.channels = [];
    this.channelSettings = [];
    this.patterns = [];
    this.binaryReader.onload = () => this.onBinaryLoad();
  }

  resetVolume() {
    this.setVolume(undefined, 0x40); // XM max volume
  }

  resetTempoBPM() {
    this.currentTempo = this.defaultTempo;
    this.currentBPM = this.defaultBPM;
  }

  onBinaryLoad() {
    this.readSongHeader();
    for (let pi = 0; pi < this.numberOfPatterns; pi++) {
      this.readPattern(pi);
    }
    this.instruments = [];
    for (let ii = 0; ii < this.numberOfInstruments; ii++) {
      this.instruments.push(this.readInstrument());
    }
    console.log(this);
    if ('onload' in this) {
      this.onload();
    }
  }

  /** Show descriptions of all parts of the song on the page. */
  drawSong() {
    this.drawSongHeader();
    if (showPatternsInput.checked) {
      for (let pi = 0; pi < this.numberOfPatterns; pi++) {
	this.drawPattern(pi);
      }
    }
    for (let ii = 0; ii < this.numberOfInstruments; ii++) {
      this.drawInstrument(ii);
    }
  }

  /** Read the song header from the XM file. */
  readSongHeader() {
    const r = this.binaryReader;
    const idText = r.readZeroPaddedString(17);
    if (idText != 'Extended Module: ') {
      throw new Error('wrong ID text: ' + idText);
    }
    this.moduleName = r.readZeroPaddedString(20);
    const magic = r.readUint8();
    if (magic != 0x1a) {
      throw new Error('wrong magic byte: ' + magic);
    }
    this.trackerName = r.readZeroPaddedString(20);
    const versionNumber = r.readUint16();
    if (versionNumber != 0x0104) {
      throw new Error('wrong version number: ' + versionNumber);
    }
    const headerSize = r.readUint32();
    if (headerSize != 276) {
      throw new Error('wrong header size: ' + headerSize);
    }
    // TODO more errors/warnings
    this.songLength = r.readUint16();
    this.restartPosition = r.readUint16();
    this.numberOfChannels = r.readUint16();
    for (let ci = 0; ci < this.numberOfChannels; ci++) {
      this.channels[ci] = new Channel(this);
    }
    this.numberOfPatterns = r.readUint16();
    this.numberOfInstruments = r.readUint16();
    this.flags = r.readUint16();
    this.defaultTempo = r.readUint16();
    this.currentTempo = this.defaultTempo;
    this.defaultBPM = r.readUint16();
    this.currentBPM = this.defaultBPM;
    this.patternOrder =
      r.readIntegers(256, false, 1, true).slice(0,this.songLength);
  }

  /** Describe the song header in songTable and patternOrderDiv. */
  drawSongHeader() {
    songTable.innerHTML +=
      `<tr><td>Module name:</td><td>${this.moduleName.encodeHTML()}</td></tr>` +
      `<tr><td>Tracker name:</td><td>${this.trackerName.encodeHTML()}</td></tr>` +
      `<tr><td>Song length:</td><td>${this.songLength} patterns<td></tr>` +
      `<tr><td>Restart position:</td><td>pattern ${this.restartPosition} in pattern order</td></tr>` +
      `<tr><td>Number of channels:</td><td>${this.numberOfChannels}</td></tr>` +
      `<tr><td>Number of patterns:</td><td>${this.numberOfPatterns}</td></tr>` +
      `<tr><td>Number of instruments:</td><td>${this.numberOfInstruments}</td></tr>` +
      `<tr><td>Frequency table:</td><td>${(this.flags & 1) ? 'Linear' : 'Amiga'}</td></tr>` +
      `<tr><td>Default tempo:</td><td>${this.defaultTempo} ticks per row<td></tr>` +
      `<tr><td>Default BPM:</td><td>${this.defaultBPM} (${this.defaultBPM/2.5} ticks per second)<td></tr>`;
    for (let i = 0; i < this.songLength; i++) {
      patternOrderDiv.innerHTML += ((i==0) ? '' : ', ') + this.patternOrder[i];
    }
  }

  /** Read a pattern from the XM file and add it to this.patterns.
   * @param {number} pi - pattern index
   */
  readPattern(pi) {
    const r = this.binaryReader;
    const patternHeaderLength = r.readUint32();
    if (patternHeaderLength != 9) { console.warn('wrong pattern header length; expected 9 but got ' + patternHeaderLength); }
    const packingType = r.readUint8();
    if (packingType != 0) { console.warn('wrong packing type; expected 0 but got 0x' + packingType.toString(16)); }
    const numberOfRows = r.readUint16();
    if (numberOfRows == 0) { console.warn('no rows'); }
    if (numberOfRows > 256) { console.warn('too many rows; expected <=256 but got ' + numberOfRows); }
    const packedPatternDataSize = r.readUint16();
    const packedPatternData =
      r.readIntegers(packedPatternDataSize, false, 1, true);
    // unpack
    const pat = [];
    this.patterns.push(pat);
    let row;
    let pdi = 0;
    let ci = 0;
    let actualNumberOfRows = 0;
    while (pdi < packedPatternData.length) {
      // start row if necessary
      if (ci == 0) {
	row = [];
	pat.push(row);
      }
      // decode note
      const note = [];
      row.push(note);
      if (packedPatternData[pdi] & 0x80) {
	const col = packedPatternData[pdi++];
	if (col & 1) {
	  const noteNum = packedPatternData[pdi++];
	  note.push(noteNum);
	} else {
	  note.push(0);
	}
	for (let x = 1; x < 5; x++) {
	  if (col & (1 << x)) {
	    const cell = packedPatternData[pdi++];
	    note.push(cell);
	  } else {
	    note.push(0);
	  }
	}
      } else {
	const noteNum = packedPatternData[pdi++];
	note.push(noteNum);
	for (let x = 1; x < 5; x++) {
	  const cell = packedPatternData[pdi++];
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
      console.warn(`wrong number of rows; expected ${numberOfRows} but got ${actualNumberOfRows}`);
    }
    if (ci != 0) {
      console.warn('number of notes not divisible by number of channels; remainder=' + ci);
    }
  }

  /** Append a description of a pattern to patternsDiv.
   * @param {number} pi - pattern index
   */
  drawPattern(pi) {
    appendHeading(patternsDiv, 3, 'Pattern ' + pi);
    appendButton(patternsDiv, '▶',
      this.playPattern.bind(this,
	this.patterns[pi], pi, 0, undefined, false, undefined));
    appendButton(patternsDiv, '↺',
      this.playPattern.bind(this,
	this.patterns[pi], pi, 0, undefined, true, undefined));
    appendBreak(patternsDiv);
    let table = '<tr><th title="row number">Rw</th>';
    let ci;
    for (ci = 0; ci < this.numberOfChannels; ci++) {
      table += '<th class="note" title="note">Not</th><th class="col-1" title="instrument">In</th><th class="col-2" title="volume">Vl</th><th class="col-3" title="effect type">E</th><th class="col-4" title="effect parameters">Pr</th>';
    }
    table += '</tr>';
    for (let ri = 0; ri < this.patterns[pi].length; ri++) {
      const row = this.patterns[pi][ri];
      table += `<tr id="pattern-${pi}-row-${ri}" class="row-${ri % 8}"><td class="row-num">${ri.toString(16)}</td>`;
      for (const note of row) {
	// get tooltips
	const tooltips = noteTooltips(note);
	// wrap them in title attribute if present
	for (let i = 0; i < 5; i++) {
	  if (tooltips[i] === undefined) {
	    tooltips[i] = '';
	  } else {
	    tooltips[i] = ` title="${tooltips[i]}"`;
	  }
	}
	// write table cells for note
	table +=
	  `<td class="note"${tooltips[0]}>${noteNumberToName(note[0])}</td>` +
	  `<td class="col-1"${tooltips[1]}>` +
	    ((note[1] == 0) ? '··' : note[1].toString(16)) +
	  '</td>' +
	  `<td class="col-2"${tooltips[2]}>${formatVolume(note[2])}</td>` +
	  `<td class="col-3"${tooltips[3]}>` +
	    ((note[3] == 0 && note[4] == 0) ? '·' : note[3].toString(36)) +
	  '</td>' +
	  `<td class="col-4"${tooltips[4]}>` +
	    ((note[3] == 0 && note[4] == 0) ? '··' :
	      ((note[4] < 0x10) ? '0' : '') + note[4].toString(16)) +
	  '</td>';
      }
      table += '</tr>';
    }
    const tableElement = document.createElement('table');
    patternsDiv.appendChild(tableElement);
    tableElement.innerHTML = table;
  }

  /** Read an instrument from the XM file.
   * @return {Object} the instrument
   */
  readInstrument() {
    const r = this.binaryReader;
    const instr = {};
    const instrumentHeaderSize = r.readUint32();
    if (instrumentHeaderSize < 29) {
      console.warn('instrument header size too small; expected >=29 but got ' + instrumentHeaderSize);
    }
    instr.name = r.readZeroPaddedString(22);
    const instrumentType = r.readUint8();
    if (instrumentType != 0) { console.warn('wrong instrument type; expected 0 but got 0x' + instrumentType.toString(16)); }
    instr.numberOfSamples = r.readUint16();
    if (instrumentHeaderSize >= 243) {
      const sampleHeaderSize = r.readUint32();
      if (sampleHeaderSize != 40) {
	console.warn('wrong sample header size; expected 40, but got ' + sampleHeaderSize);
      }
      instr.sampleNumberForAllNotes = r.readIntegers(96, false, 1, true);
      // volume and panning envelopes
      const pointsForVolumeEnvelope = r.readIntegers(24, false, 2, true);
      const pointsForPanningEnvelope = r.readIntegers(24, false, 2, true);
      const numberOfVolumePoints = r.readUint8();
      const numberOfPanningPoints = r.readUint8();
      const volumeSustainPoint = r.readUint8();
      const volumeLoopStartPoint = r.readUint8();
      const volumeLoopEndPoint = r.readUint8();
      const panningSustainPoint = r.readUint8();
      const panningLoopStartPoint = r.readUint8();
      const panningLoopEndPoint = r.readUint8();
      const volumeType = r.readUint8();
      const panningType = r.readUint8();
      this.interpretVolumePanning(instr, 'volume', pointsForVolumeEnvelope, numberOfVolumePoints, volumeSustainPoint, volumeLoopStartPoint, volumeLoopEndPoint, volumeType);
      this.interpretVolumePanning(instr, 'panning', pointsForPanningEnvelope, numberOfPanningPoints, panningSustainPoint, panningLoopStartPoint, panningLoopEndPoint, panningType);
      // vibrato
      instr.vibratoType = r.readUint8();
      instr.vibratoSweep = r.readUint8();
      instr.vibratoDepth = r.readUint8();
      instr.vibratoRate = r.readUint8();
      // other
      instr.volumeFadeout = r.readUint16();
      /*const reserved = */r.readUint16();
      if (instrumentHeaderSize > 243) {
	const count = instrumentHeaderSize - 243;
	console.warn(`ignoring ${count} extra bytes after first 243 bytes of instrument header`);
	r.readIntegers(count, false, 1, true);
      }
    } else if (instrumentHeaderSize > 29) {
      const count = instrumentHeaderSize - 29;
      console.warn(`ignoring ${count} extra bytes after first 29 bytes of instrument header`);
      r.readIntegers(count, false, 1, true);
    }
    instr.samples = [];
    for (let si = 0; si < instr.numberOfSamples; si++) {
      instr.samples.push(this.readSampleHeader());
    }
    for (let si = 0; si < instr.numberOfSamples; si++) {
      this.readSampleData(instr.samples[si]);
    }
    return instr;
  }

  /** Append a description of an instrument to instrumentsDiv.
   * @param {number} ii - instrument index
   */
  drawInstrument(ii) {
    appendHeading(instrumentsDiv, 3, 'Instrument ' + (ii+1).toString(16));
    appendButton(instrumentsDiv, '▶',
	this.playNote.bind(this, [65, ii+1, 0,0,0], 0));
    appendBreak(instrumentsDiv);
    const instr = this.instruments[ii];
    appendLine(instrumentsDiv, 'Name: ' + instr.name);
    if (instr.numberOfSamples > 1 && 'sampleNumberForAllNotes' in instr) {
      let snfan = 'Sample number for all notes:';
      for (let i = 0; i < 96; i++) {
	snfan += ' ' + instr.sampleNumberForAllNotes[i];
      }
      appendLine(instrumentsDiv, snfan);
    }
    this.drawVolumePanning(instr, 'volume');
    this.drawVolumePanning(instr, 'panning');
    if (instr.vibratoType || instr.vibratoSweep ||
	instr.vibratoDepth || instr.vibratoRate) {
      appendLine(instrumentsDiv, `Vibrato: ${vibratoTypes[instr.vibratoType]}(sweep=reach full depth at ${instr.vibratoSweep} ticks after vibrato start; depth = ±${instr.vibratoDepth} / 16 semitones; rate=${instr.vibratoRate} / 256 cycles per tick)`);
    }
    if (instr.volumeFadeout > 0) {
      appendLine(instrumentsDiv, `Volume fadeout: reduce volume by ${instr.volumeFadeout} / 32768 of what its full volume would be otherwise, per tick after note release`);
    }
    for (let si = 0; si < instr.numberOfSamples; si++) {
      appendHeading(instrumentsDiv, 4, 'Sample ' + si);
      this.drawSampleHeader(instr.samples[si]);
      this.drawSampleData(instr.samples[si]);
    }
  }

  /** Interpret volume or panning fields from an XM file and add them to an
   * instrument object.
   * @param {Object} instr - instrument to be returned by {@link
   * #readInstrument}
   * @param {string} volumeOrPanning - 'volume' or 'panning'
   * @param {number[24]} points - flattened point data, 16-bit unsigned integers
   * @param {number} numberOfPoints - number of valid points in the data
   * @param {number} sustainPoint - index of point to stay at while sustaining
   * a note
   * @param {number} loopStartPoint - index of the point at the start of the
   * loop
   * @param {number} loopEndPoint - index of the point at the end of the loop
   * @param {number} type - volume or panning type flags: 1=on, 2=sus, 4=loop
   */
  interpretVolumePanning(
    instr, volumeOrPanning, points, numberOfPoints,
    sustainPoint, loopStartPoint, loopEndPoint, type
  ) {
    if (type & 1) { // On
      const envelope = instr[volumeOrPanning + 'Envelope'] = [];
      for (let i = 0; i < numberOfPoints; i++) {
	envelope.push(points.slice(i*2,i*2+2));
      }
      if (type & 2) { // Sustain
	instr[volumeOrPanning + 'SustainPoint'] = sustainPoint;
      }
      if (type & 4) { // Loop
	instr[volumeOrPanning + 'LoopStartPoint'] = loopStartPoint;
	instr[volumeOrPanning + 'LoopEndPoint'] = loopEndPoint;
      }
    }
  }

  /** Append a drawing of a volume or panning envelope to instrumentsDiv.
   * @param {Object} instr - instrument as returned by {@link #readInstrument}
   * @param {string} volumeOrPanning - 'volume' or 'panning'
   */
  drawVolumePanning(instr, volumeOrPanning) {
    if ((volumeOrPanning + 'Envelope') in instr) {
      appendHeading(instrumentsDiv, 4,
	  // capitalize
	  volumeOrPanning.slice(0,1).toUpperCase() + volumeOrPanning.slice(1));
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 192 64');
      svg.setAttribute('width',384);
      svg.setAttribute('height',128);
      instrumentsDiv.appendChild(svg);
      const bg = document.createElementNS(svgNS, 'rect');
      bg.setAttribute('x',0);
      bg.setAttribute('y',0);
      bg.setAttribute('width',192);
      bg.setAttribute('height',64);
      svg.appendChild(bg);
      const p = document.createElementNS(svgNS, 'path');
      let path = '';
      const envelope = instr[volumeOrPanning + 'Envelope'];
      for (let i = 0; i < envelope.length; i++) {
	path += (i == 0 ? 'M ' : ' L ') + envelope[i][0] + ' ' + (64-envelope[i][1]);
      }
      p.setAttribute('d', path);
      svg.appendChild(p);
      appendBreak(instrumentsDiv);
      if ((volumeOrPanning + 'SustainPoint') in instr) {
	appendLine(instrumentsDiv, 'Sustain point: ' + instr[volumeOrPanning + 'SustainPoint']);
      }
      if ((volumeOrPanning + 'LoopStartPoint') in instr) { // Loop
	appendLine(instrumentsDiv, `Loop: ${instr[volumeOrPanning + 'LoopStartPoint']}-${instr[volumeOrPanning + 'LoopEndPoint']}`);
      }
    }
  }

  /** Read the header of a sample into an object.
   * @return {Object} the read sample header
   */
  readSampleHeader() {
    const r = this.binaryReader;
    const s = {};
    s.lengthInBytes = r.readUint32();
    s.loopStart = r.readUint32();
    s.loopLength = r.readUint32();
    s.volume = r.readUint8();
    s.finetune = r.readIntegers(1, true, 1, true)[0];
    const type = r.readUint8();
    s.loopType = (type & 3);
    s.bytesPerSample = ((type & (1<<4)) ? 2 : 1);
    s.panning = r.readUint8();
    s.relativeNoteNumber = r.readIntegers(1, true, 1, true)[0];
    /*const reserved = */r.readUint8();
    s.name = r.readZeroPaddedString(22);
    return s;
  }

  /** Append a description of a sample header to instrumentsDiv.
   * @param {Object} s - sample structure as returned by {@link
   * #readSampleHeader}
   */
  drawSampleHeader(s) {
    const table = document.createElement('table');
    instrumentsDiv.appendChild(table);
    table.innerHTML =
      `<tr><td>Name:</td><td>${s.name}</td></tr>` +
      `<tr><td>Relative note number:</td><td>${s.relativeNoteNumber} semitones</td></tr>` +
      `<tr><td>Finetune:</td><td>${s.finetune} / 128 semitones</td></tr>` +
      `<tr><td>Volume:</td><td>${s.volume} / 64</td></tr>` +
      `<tr><td>Panning:</td><td>${s.panning} / 255 right</td></tr>`;
    if (s.loopType) {
      table.innerHTML +=
	`<tr><td>Loop:</td><td>${loopTypes[s.loopType]} ${s.loopStart} bytes - ${(s.loopLength + s.loopStart)} bytes</td></tr>`;
    }
    table.innerHTML +=
      `<tr><td>Length:</td><td>${s.lengthInBytes} bytes (${s.bytesPerSample} byte(s) per sample)</td></tr>`;
  }

  /** Read waveform data into a sample.
   * @param {Object} s - sample structure as returned by {@link
   * #readSampleHeader}
   */
  readSampleData(s) {
    const deltas = this.binaryReader.readIntegers(
      s.lengthInBytes / s.bytesPerSample, true, s.bytesPerSample, true);
    s.data = [];
    const maxint = (1 << (8*s.bytesPerSample));
    const maxsint = (maxint>>1)-1;
    const minsint = -(maxint>>1);
    let old = 0;
    for (const delta of deltas) {
      let neww = old + delta;
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

  /** Append a drawing of a sample waveform to instrumentsDiv.
   * @param {Object} s - sample structure as returned by {@link
   * #readSampleHeader} and read into by {@link #readSampleData}
   */
  drawSampleData(s) {
    // draw waveform on a canvas
    const canvas = document.createElement('canvas');
    canvas.setAttribute('height', 256);
    let horizDivisor = Math.floor(s.data.length / 512);
    if (horizDivisor == 0) { horizDivisor = 1; }
    canvas.setAttribute('width', 512);
    instrumentsDiv.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    let min = 256;
    let max = 0;
    for (let i = 0; i < s.data.length; i++) {
      const scaled =
	128 + ((s.bytesPerSample == 2) ? Math.trunc(s.data[i]/256) : s.data[i]);
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
	const bs = sampleDataToBufferSource(s.data, s.bytesPerSample);
	// TODO apply sample volume (0-64), panning (left 0 - right 255)
	bs.playbackRate =
	  computePlaybackRate(64, s.relativeNoteNumber, s.finetune);
	bs.connect(xm.masterVolume);
	bs.start();
      }
    );
  }

  /** Set the global volume.
   * @see Channel#setVolume
   * @param {number} [when=actx.currentTime]
   * @param {number} volume
   */
  setVolume(when, volume) {
    if (when === undefined) { when = actx.currentTime; }
    this.globalVolume = volume;
    const volumeFraction = maxVolume * volume / 0x40;
    if (when > actx.currentTime) {
      this.masterVolume.gain.setValueAtTime(volumeFraction, when);
    } else {
      this.masterVolume.gain.value = volumeFraction;
    }
  }

  /** Slide the global volume up or down.
   * @see Channel#volumeSlide
   * @param {number} when
   * @param {boolean} up
   * @param {number} rate
   */
  volumeSlide(when, up, rate) {
    const duration = this.rowDuration();
    const oldVolume = this.globalVolume;
    let newVolume = oldVolume + (up ? 1 : -1) * rate * this.currentTempo;
    // clamp 0-0x40
    if (newVolume < 0) {
      newVolume = 0;
    } else if (newVolume > 0x40) {
      newVolume = 0x40;
    }
    this.globalVolume = newVolume; // for next row
    // FIXME should I make sure it's exactly oldVolume at "when", in case it's
    // not now?
    this.masterVolume.gain.linearRampToValueAtTime(
	maxVolume * newVolume / 0x40, when + duration);
  }

  /**
   * @param {number} effectParam - porta effect parameter value: porta rate in
   * 16ths of a semitone per tick
   * @return {number} the factor to multiply (porta up) or divide (porta down)
   * the playback rate by for an entire row (not just one tick)
   */
  portaToPlaybackRateFactor(effectParam) {
    return Math.pow(2, effectParam * this.currentTempo / (16*12));
  }

  playNote(note, channel) {
    this.channels[channel].applyCommand(actx.currentTime /*FIXME*/, note);
  }

  playRow(row) {
    for (let i = 0; i < row.length; i++) {
      this.playNote(row[i], i);
    }
  }

  /** @return {number} the current duration of one tick in seconds */
  tickDuration() {
    return 2.5 / this.currentBPM;
  }

  /** @return {number} the current duration of one pattern row in seconds */
  rowDuration() {
    return this.currentTempo * this.tickDuration();
  }

  /** Play (the rest of) one pattern in a song.
   * @param {Array.<Array.<number[5]>>} pattern - array of rows, each of which
   * is an array of notes, each of which is an array of 5 numbers
   * @param {number} patternIndex - index of the pattern in the patterns array
   * @param {number} [startRow=0] - index of the pattern row to start with
   * @param {Function} [onEnded] - function to call when playing this pattern
   * has ended
   * @param {boolean} [loop=false] - whether to loop at the end of the pattern
   * @param {number} [startTime=actx.currentTime] - time to start playing
   */
  playPattern(pattern, patternIndex, startRow, onEnded, loop, startTime) {
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
      const delay = this.rowDuration();
      // recurse on next row
      afterDelay(startTime, delay,
	this.playPattern.bind(this,
	  pattern, patternIndex, startRow+1, onEnded, loop));
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

  stopAllChannels() {
    this.nextSongPosition = undefined;
    this.nextPatternStartRow = undefined;
    for (const c of this.channels) { c.cutNote(); }
  }

  /** Play (the rest of) one whole song.
   * @param {number} [startIndex=0] - song position to start at
   * @param {Function} [onEnded] - function to call when playing has ended
   * @param {boolean} [loop=false] - whether to loop at the end of the song
   */
  playSong(startIndex, onEnded, loop) {
    if (stopPlease) {
      if (onEnded !== undefined) {
	onEnded.call();
      }
      return;
    }
    if (startIndex === undefined) { startIndex = 0; }
    if (startIndex == 0) { this.resetTempoBPM(); } // I think?
    if (this.nextSongPosition !== undefined) {
      startIndex = this.nextSongPosition;
      this.nextSongPosition = undefined;
    }
    if (startIndex < this.patternOrder.length) {
      this.currentSongPosition = startIndex;
      let startRow = 0;
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
}
