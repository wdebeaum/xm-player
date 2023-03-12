// FIXME assumes linear frequency table
function computePlaybackRate(noteNum, relNoteNum, fineTune) {
  // this is different from the formula in the spec, but is more readable
  return Math.pow(2, (noteNum - 1 + relNoteNum - 48/*C-4*/ + fineTune/128)/12) * 8363 / 44100;
}

/* exported actx,maxVolume,showPatternsInput,songTable,patternOrderDiv,patternsDiv,instrumentsDiv,rowHighlight */
var actx;
var maxVolume = 0.2;
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

/* exported stopPlease,stopPlaying,xm */
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
