/*
Big thanks to FP(FunPoster/system2k) for converting eldit file extension .pxr to Node JS
*/

const fs = require("fs");
const EventEmitter = require("events");

const util = require('util');


let _file_exists = util.promisify(fs.access);

async function file_exists(file) {
  try {
    await _file_exists(file, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}


let _file_size = util.promisify(fs.fstat);

async function file_size(fd) {
  let stat = await _file_size(fd);

  return stat.size;
}


let _file_open = util.promisify(fs.open);

async function file_open(path) {
  return await _file_open(path, "r+");
}


let file_close = util.promisify(fs.close);



let _file_write = util.promisify(fs.write);

async function file_write(fd, offset, data) {
  return await _file_write(fd, data, 0, data.length, offset);
}


let write_file = util.promisify(fs.writeFile);


let _file_read = util.promisify(fs.read);

async function file_read(fd, offset, len) {
  let res = Buffer.alloc(len);

  let total_read = await _file_read(fd, res, 0, len, offset);

  if (total_read < len) {
    return res.slice(0, total_read);
  } else {
    return res;
  }
}


let file_read_all = util.promisify(fs.readFile);

let file_mkdir = util.promisify(fs.mkdir);


function hexToRgb(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
   hex = hex.replace(shorthandRegex, function(m, r, g, b) {
     return r + r + g + g + b + b;
   });

   let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : null;
}

/*
sync:
chunkIsProtected
worldUnload
getProp
setProp
setChunkProtection

async:
getChunk
_setChunk
loadProps
worldInit
setChunk
closeDatabase
setPixel
getPixel
updateDatabase
*/

class Manager extends EventEmitter {
  constructor(databaseUpdateRate = 1000 * 60 * 5, databasePath = "./chunkdata/", maxFileHandles = 500) {
    super();
    this.databasePath = databasePath;
    this.pchunksPath = "pchunks.bin";
    this.propsPath = "props.txt";
    this.pxrPath = "r.{x}.{y}.pxr";

    this.databaseUpdateRate = databaseUpdateRate;
    this.maxFileHandles = maxFileHandles;

    if (!fs.existsSync(this.databasePath)) {
      fs.mkdirSync(this.databasePath, 0o777);
    }


    this.fileHandles = {}; // "worldName;clusterX;clusterY"
    this.pendingUnload = {};
    this.chunkWrites = {}; // pending chunk updates
    this.chunkCache = {};
    this.loadedProps = {}; // properties
    this.loadedProts = {}; // protections
    //this.pixelQueue = {}; // {worldName: {chunkX,chunkY: {i: [...color]}}}
    this.pendingLoad = {}; // {worldName: {chunkX,chunkY: promise}}

    this.databaseUpdateInterval = setInterval(this.updateDatabase.bind(this), this.databaseUpdateRate); //dont remove bind cuz then the emit will not work
  }
  chunkIsProtected(worldName, x, y) {
    if (!this.loadedProts[worldName]) throw "World " + worldName + " is not initialized";
    var hash = this.loadedProts[worldName].hashTable;
    if (!hash[y]) return false;
    return !!hash[y][x];
  }
  async _getChunk(worldName, x, y) {
    if(this.pendingLoad[worldName][x + "," + y]) {
      await this.pendingLoad[worldName][x + "," + y];
    }
    if(this.chunkCache[worldName][x + "," + y]) {
      return this.chunkCache[worldName][x + "," + y];
    }
    let regX = x >> 5;
    let regY = y >> 5;
    var fd = null;
    if (this.fileHandles[worldName + ";" + regX + ";" + regY]) {
      fd = this.fileHandles[worldName + ";" + regX + ";" + regY];
    } else {
      var clusterPath = this.databasePath + worldName + "/" + this.pxrPath.replace("{x}", regX).replace("{y}", regY);
      if (!await file_exists(clusterPath)) {
        return null
      };
    }
    if (fd == null) {
      var keys = Object.keys(this.fileHandles);
      if (keys.length >= this.maxFileHandles) {
        var key = keys[0];
        await file_close(this.fileHandles[key]);
        delete this.fileHandles[key];
      }
      fd = await file_open(clusterPath);
      this.fileHandles[worldName + ";" + regX + ";" + regY] = fd;
    }
    var clusterSize = await file_size(fd);
    if (clusterSize < 3072) {
      return null;
    }
    var lookup = 3 * ((x & 31) + (y & 31) * 32);
    var chunkpos = await file_read(fd, lookup, 3);
    chunkpos = chunkpos[2] * 16777216 + chunkpos[1] * 65536 + chunkpos[0] * 256;
    if (chunkpos == 0) {
      return null;
    }
    var cdata = await file_read(fd, chunkpos, 16 * 16 * 3);
    this.chunkCache[worldName][x + "," + y] = cdata;
    return cdata;
  }
  getChunk(worldName, x, y) {
    let chunk = this._getChunk(worldName, x, y);
    this.pendingLoad[worldName][x + "," + y] = new Promise(async resolve=>{
      await chunk;
      resolve();
      delete this.pendingLoad[worldName][x + "," + y];
    });
    return chunk;
  }
  async _setChunk(worldName, x, y, cdata) { // cdata = 16*16*3 RGB
    var regX = x >> 5;
    var regY = y >> 5;
    var fd = null;
    if (this.fileHandles[worldName + ";" + regX + ";" + regY]) {
      fd = this.fileHandles[worldName + ";" + regX + ";" + regY];
    } else {
      var clusterPath = this.databasePath + worldName + "/" + this.pxrPath.replace("{x}", regX).replace("{y}", regY);
      if (await file_exists(clusterPath)) {
        fd = await file_open(clusterPath);
        this.fileHandles[worldName + ";" + regX + ";" + regY] = fd;
      } else {
        await write_file(clusterPath, new Uint8Array(3072));
        fd = await file_open(clusterPath);
        this.fileHandles[worldName + ";" + regX + ";" + regY] = fd;
      }
    }
    var clusterSize = await file_size(fd);
    if (clusterSize < 3072) { // pad remaining lookup table
      await file_write(fd, clusterSize, new Uint8Array(3072 - clusterSize));
    }
    var lookup = 3 * ((x & 31) + (y & 31) * 32);
    var chunkpos = await file_read(fd, lookup, 3);
    chunkpos = chunkpos[2] * 16777216 + chunkpos[1] * 65536 + chunkpos[0] * 256;
    if (chunkpos == 0) {
      var val = clusterSize;
      await file_write(fd, lookup, new Uint8Array([Math.floor((val / 256)) % 256, Math.floor((val / 65536)) % 256, Math.floor((val / 16777216)) % 256]));
      chunkpos = await file_size(fd);
    }
    await file_write(fd, chunkpos, cdata);
  }
  async loadProps(worldName) {
    var prop_path = this.databasePath + worldName + "/" + this.propsPath;
    if (!await file_exists(prop_path)) return {};
    var data = (await file_read_all(prop_path)).toString("utf8").split("\n");
    var props = {};
    for (var i = 0; i < data.length; i++) {
      if (!data[i]) continue;
      var line = data[i].split(" ");
      var key = line[0];
      var prop = data[i].substr(key.length + 1);
      props[key] = prop;
    }
    return props
  }
  async worldInit(worldName) {
    if (this.pendingUnload[worldName]) {
      delete this.pendingUnload[worldName];
      return;
    }
    if (this.chunkCache[worldName] || this.loadedProps[worldName] || this.loadedProts[worldName]) return;
    if (!await file_exists(this.databasePath + worldName)) {
      await file_mkdir(this.databasePath + worldName, 0o777);
    }
    worldName = worldName.replace(/\//g, "").replace(/\\/g, "").replace(/\"/g, "");
    var protPath = this.databasePath + worldName + "/" + this.pchunksPath;
    if (await file_exists(protPath)) {
      var protData = await file_read_all(protPath.slice(0));
      var protTotal = Math.floor(protData.length / 8);
      var protInt = new Int32Array(new Uint8Array(protData).buffer);
      var protHash = {};
      for (var i = 0; i < protTotal; i++) {
        var pos = i * 2;
        var x = protInt[pos];
        var y = protInt[pos + 1];
        if (!protHash[y]) protHash[y] = {};
        protHash[y][x] = true;
      }
      this.loadedProts[worldName] = {
        hashTable: protHash,
        updated: false
      };
    } else {
      this.loadedProts[worldName] = {
        hashTable: {},
        updated: false
      };
    }
    this.loadedProps[worldName] = {
      data: await this.loadProps(worldName),
      updated: false
    };
    this.chunkCache[worldName] = {};
    this.chunkWrites[worldName] = {};
    this.pendingLoad[worldName] = {};
  }
  worldUnload(worldName) {
    this.pendingUnload[worldName] = true;
  }
  getProp(worldName, key, defval) {
    if (!this.loadedProps[worldName]) throw "World " + worldName + " is not initialized";
    if (key in this.loadedProps[worldName].data) return this.loadedProps[worldName].data[key].replace(/\\n/gm, "\n");;
    return defval;
  }
  setProp(worldName, key, val) {
    if (!this.loadedProps[worldName]) throw "World " + worldName + " is not initialized";
    if (!val) {
      delete this.loadedProps[worldName].data[key];
      this.loadedProps[worldName].updated = true;
      return;
    }
    val = val.toString().replace(/\n/gm, "\\n");
    this.loadedProps[worldName].data[key] = val;
    this.loadedProps[worldName].updated = true;
  }
  setChunkProtection(worldName, x, y, isProtected) {
    var protStat = this.chunkIsProtected(worldName, x, y);
    var protHash = this.loadedProts[worldName].hashTable;
    if (isProtected) {
      if (protStat) return;
      if (!protHash[y]) protHash[y] = {};
      protHash[y][x] = true;
      this.loadedProts[worldName].updated = true;
    } else {
      if (!protStat) return;
      delete protHash[y][x];
      if (Object.keys(protHash[y]).length == 0) {
        delete protHash[y];
      }
      this.loadedProts[worldName].updated = true;
    }
  }
  async setChunk(worldName, chunkX, chunkY, chunkData) {
    var chunk = await this.getChunk(worldName, chunkX, chunkY);
    if (!chunk) {
      chunk = new Uint8Array(16 * 16 * 3);
      this.chunkCache[worldName][chunkX + "," + chunkY] = chunk;
    }
    for (var i = 0; i < 16 * 16 * 3; i++) {
      chunk[i] = chunkData[i];
    }
    this.chunkWrites[worldName][chunkX + "," + chunkY] = true;
  }
  async closeDatabase() {
    clearInterval(this.databaseUpdateInterval);
    await this.updateDatabase();
    for (var i in this.fileHandles) {
      await file_close(this.fileHandles[i]);
    }
  }
  async setPixel(worldName, x, y, r, g, b) {
    var chunkX = Math.floor(x / 16);
    var chunkY = Math.floor(y / 16);
    var pixelX = x - Math.floor(x / 16) * 16;
    var pixelY = y - Math.floor(y / 16) * 16;

    var chunk = await this.getChunk(worldName, chunkX, chunkY);
    if (!chunk) {
      chunk = new Uint8Array(16 * 16 * 3);
      let chunkColor = hexToRgb(this.getProp(worldName, "bgcolor", "fff")) || [255, 255, 255];
      for (var i = 0; i < chunk.length;) {
        chunk[i++] = chunkColor[0];
        chunk[i++] = chunkColor[1];
        chunk[i++] = chunkColor[2];
      }
      this.chunkCache[worldName][chunkX + "," + chunkY] = chunk;
    }
    var idx = (pixelY * 16 + pixelX) * 3;
    chunk[idx] = r;
    chunk[idx + 1] = g;
    chunk[idx + 2] = b;
    this.chunkWrites[worldName][chunkX + "," + chunkY] = true;
  }
  async getPixel(worldName, x, y) {
    var chunkX = Math.floor(x / 16);
    var chunkY = Math.floor(y / 16);
    var pixelX = x - Math.floor(x / 16) * 16;
    var pixelY = y - Math.floor(y / 16) * 16;
    var chunk = await this.getChunk(worldName, chunkX, chunkY);
    if (!chunk) {
      return null;
    }
    var idx = (pixelY * 16 + pixelX) * 3;
    return [chunk[idx], chunk[idx+1], chunk[idx+2]]
  }
  async updateDatabase() {
    for (var world in this.loadedProts) {
      if (this.loadedProts[world].updated) {
        this.loadedProts[world].updated = false;
      } else {
        continue;
      }
      var protArray = [];
      var hashTable = this.loadedProts[world].hashTable;
      for (var y in hashTable) {
        for (var x in hashTable[y]) {
          protArray.push([parseInt(x), parseInt(y)]);
        }
      }
      var protBuffer = new Int32Array(protArray.length * 2);
      for (var i = 0; i < protArray.length; i++) {
        var idx = i * 2;
        protBuffer[idx] = protArray[i][0];
        protBuffer[idx + 1] = protArray[i][1];

      }
      await write_file(this.databasePath + world + "/" + this.pchunksPath, protBuffer);
    }
    for (var world in this.loadedProps) {
      if (this.loadedProps[world].updated) {
        this.loadedProps[world].updated = false;
      } else {
        continue;
      }
      var propStr = "";
      var data = this.loadedProps[world].data;
      for (var i in data) {
        propStr += i + " " + data[i] + "\n";
      }
      await write_file(this.databasePath + world + "/" + this.propsPath, propStr);
    }
    for (var world in this.chunkCache) {
      var chunks = this.chunkCache[world];
      for (var c in chunks) {
        var pos = c.split(",");
        var chunkX = parseInt(pos[0]);
        var chunkY = parseInt(pos[1]);
        if (this.chunkWrites[world][chunkX + "," + chunkY]) {
          this.chunkWrites[world][chunkX + "," + chunkY] = false;
        } else {
          delete chunks[c];
          continue;
        }
        await this._setChunk(world, chunkX, chunkY, chunks[c]);
        delete chunks[c];
      }
    }
    for (var world in this.pendingUnload) {
      for (var i in this.fileHandles) {
        var hdl = i.split(";");
        if (hdl[0] == world) {
          await file_close(this.fileHandles[i]);
          delete this.fileHandles[i];
        }
      }
      delete this.pendingUnload[world];
      delete this.pendingLoad[world];
      delete this.loadedProts[world];
      delete this.loadedProps[world];
      delete this.chunkCache[world];
      delete this.chunkWrites[world];
    }
    this.emit("savedWorlds");
  }
}

module.exports = Manager;
