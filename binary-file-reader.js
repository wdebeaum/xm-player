/* exported BinaryFileReader */
class BinaryFileReader {
  constructor(file) {
    this.pos = 0;
    this.fileReader = new FileReader();
    this.fileReader.onload = () => {
      this.buffer = this.fileReader.result;
      this.data = new DataView(this.buffer);
      this.onload();
    };
    //console.log('readAsArrayBuffer');
    this.fileReader.readAsArrayBuffer(file);
  }

  readIntegers(count, signed, bytes, littleEndian) {
    const getter = `get${(signed ? 'Int' : 'Uint')}${bytes*8}`;
    const ret = []; // TODO make this a typed array?
    //console.log(`${getter} * ${count}`);
    while (count--) {
      ret.push(this.data[getter](this.pos, littleEndian));
      this.pos += bytes;
    }
    return ret;
  }

  /* common count=1 cases */
  readUint8()  { return this.readIntegers(1, false, 1, true)[0]; }
  readUint16() { return this.readIntegers(1, false, 2, true)[0]; }
  readUint32() { return this.readIntegers(1, false, 4, true)[0]; }

  readZeroPaddedString(length) {
    const codes = this.readIntegers(length, false, 1);
    while (codes.length > 0 && codes[codes.length-1] == 0) {
      codes.pop();
    }
    return String.fromCharCode.apply(String, codes);
  }
}
