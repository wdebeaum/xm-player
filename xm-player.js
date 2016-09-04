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

var vibratoTypes = ['sine', 'square', 'saw down', 'saw up'];

var svgNS = 'http://www.w3.org/2000/svg';

var loopTypes = ['none', 'forward', 'ping-pong'];

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

var stopPlease = false;

function stopPlaying() {
  // set stopPlease to make sure onended callbacks don't start new stuff
  stopPlease = true;
  if (xm !== undefined) { xm.stopAllChannels(); }
  // after all the onended callbacks have run, reset stopPlease
  setTimeout(function() { stopPlease = false; }, 500);
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
