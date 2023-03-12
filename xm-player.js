// FIXME assumes linear frequency table
function computePlaybackRate(noteNum, relNoteNum, fineTune) {
  // this is different from the formula in the spec, but is more readable
  return Math.pow(2, (noteNum - 1 + relNoteNum - 48/*C-4*/ + fineTune/128)/12) *
	 8363 / 44100;
}

/* exported actx,maxVolume,showPatternsInput */
let actx;
const maxVolume = 0.2;
// HTML elements
let showPatternsInput;
let xmUrlInput;
let songDiv;
/* exported songTable,patternOrderDiv,patternsDiv,instrumentsDiv,rowHighlight */
let songTable;
let patternOrderDiv;
let patternsDiv;
let instrumentsDiv;
let rowHighlight;
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
    const url = location.hash.slice(1); // remove # from beginning
    fetchUrlAndRead(url);
  }
}

function highlightAndCenterRow(patternIndex, rowIndex) {
  const rowID = 'pattern-' + patternIndex + '-row-' + rowIndex;
  // scroll the row to the center of the view
  const rowElement = document.getElementById(rowID);
  rowElement.scrollIntoView(true);
  scrollBy(0,
    -(document.documentElement.clientHeight - rowElement.clientHeight) / 2);
  // make sure it's highlighted (not 'display: none')
  rowHighlight.style.display = '';
}

/* exported stopPlease,stopPlaying,xm */
let stopPlease = false;

function stopPlaying() {
  // set stopPlease to make sure onended callbacks don't start new stuff
  stopPlease = true;
  if (xm !== undefined) { xm.stopAllChannels(); }
  // after all the onended callbacks have run, reset stopPlease
  setTimeout(function() { stopPlease = false; }, 500);
}

let xm;

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
  };
}

function fetchUrlAndRead(url) {
  console.log('fetching XM file from URL: ' + url);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'blob';
  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE && xhr.status === 200) {
      console.log('fetched, reading');
      readFile(xhr.response);
    } // TODO handle HTTP errors
  };
  xhr.send();
}

function onInputFileChange(evt) {
  readFile(evt.target.files[0]);
}

function onFetch(evt) {
  fetchUrlAndRead(xmUrlInput.value);
}
