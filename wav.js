/**
 * @param {AudioBuffer} audioBuffer
 * @param {number} [duration=audioBuffer.duration] - duration in seconds of the
 * portion of audioBuffer to turn into a wav file 
 * @return {Blob} a RIFF wav file
 */
function audioBufferToWavBlob(audioBuffer, duration) {
  const channels = new Array(audioBuffer.numberOfChannels);
  for (let i = 0; i < channels.length; i++) {
    channels[i] = audioBuffer.getChannelData(i);
  }
  const sampleRate = Math.round(audioBuffer.sampleRate); // sample frames/second
  const numFrames =
    (duration === undefined) ? channels[0].length : (sampleRate * duration);
  const numSampleBytes = channels.length * numFrames * 2; // 16 bits per sample
  const arrayBuffer = new ArrayBuffer(0x2c + numSampleBytes);
  const v = new DataView(arrayBuffer);
  let pos = 0;
  function writeUint32(value) {
    v.setUint32(pos, value, true);
    pos += 4;
  }
  function writeUint16(value) {
    v.setUint16(pos, value, true);
    pos += 2;
  }
  function writeInt16(value) {
    v.setInt16(pos, value, true);
    pos += 2;
  }
  function writeFourChars(value) {
    v.setUint8(pos++, value.charCodeAt(0));
    v.setUint8(pos++, value.charCodeAt(1));
    v.setUint8(pos++, value.charCodeAt(2));
    v.setUint8(pos++, value.charCodeAt(3));
  }
  // write header
  writeFourChars('RIFF');
  writeUint32(0x24 + numSampleBytes); // file size minus these first 8 bytes
  writeFourChars('WAVE');
  writeFourChars('fmt ');
  writeUint32(0x10); // fmt chunk size
  writeUint16(1); // format tag = PCM
  writeUint16(channels.length); // number of channels (samples/frame)
  writeUint32(sampleRate); // sample frames/second
  writeUint32(sampleRate * channels.length * 2); // bytes/second
  writeUint16(1); // block align
  writeUint16(16); // bits/sample
  writeFourChars('data');
  writeUint32(numSampleBytes);
  // write data
  for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const floatSample = channels[channelIndex][frameIndex];
      let intSample = Math.round(floatSample * 0x7fff);
      if (intSample < -0x7fff) { intSample = -0x7fff; }
      if (intSample > 0x7fff) { intSample = 0x7fff; }
      writeInt16(intSample);
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
