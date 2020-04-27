// Node.js OWOP Server created by dimden and mathias377
//
// Discord: https://discord.gg/k4u7ddk
// Website: https://dimden.dev/
// Mathias377 Discord: https://discord.gg/PpZq7HB

const WebSocket = require('ws');
const fetch = require("node-fetch");
const EventEmitter = require("events");
const IpsManager = require("./IpsManager.js");
const Manager = require("./manager.js");
const os = require('os');
const moment = require('moment');
const proxy_check = require('proxycheck-node.js');
const http = require("http");
const express = require("express");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const serverVersion = require("./package.json").version;

function btoa(btoa) {
  return Buffer.from(btoa).toString("base64");
}
function atob(atob) {
  return Buffer.from(atob, 'base64').toString();
}


class Bucket {
	constructor(rate, time, infinite = true) {
		this.lastCheck = Date.now();
		this.allowance = 0;
		this.rate = rate;
		this.time = time;
		this.infinite = infinite;
	}

	update() {
		this.allowance += (Date.now() - this.lastCheck) / 1000 * (this.rate / this.time);
		this.lastCheck = Date.now();
		if (this.allowance > this.rate) {
			this.allowance = this.rate;
		}
	}

	canSpend(count) {
		if (this.infinite) {
			return true;
		}

		this.update();
		if (this.allowance < count) {
			return false;
		}
		this.allowance -= count;
		return true;
	}
}

class Server extends EventEmitter {
  /*
  OPTIONS:
  [class]server - http/https server. (optional)
  [number]port - port of WS server. (optional, default - 3000)
  [array]defaultPQuota - default PQuota. Array template - [rate, time]. (optional, default - [64, 4])
  [string]adminlogin - admin password. (required)
  [string]modlogin - moderator password. (required)
  [string]captchaKey - grecaptcha private key. (required if "captcha" is true, otherwise optional)
  [string]captchapass - captcha passworld. (required if "captcha" is true, otherwise optional)
  [number]captchaSecurity - captcha security level. 0 = no captcha, 1 = captcha only once, 2 = captcha everytime (optional, default - 0)
  [number]updateInterval - update interval in ms. (optional, default - 1000/60)
  [number]saveInterval - database save interval in ms. (optional, default - 5000)
  [string]database - database file location. (optional, default - database.db )
  [number]chunksUpdateRate - worlds/chunks saving rate. (optional, default - Math.floor(1000 / 30))
  */
  /*
  EVENTS:
  name - description [arguments].

  user did:
  join - emits when user connected and got verificated. [user]
  open - emits when user connected to server. [user]
  close - emits when user got disconnected. [user]
  rawMessage - emits when user sends message to server. [user, message]
  message - emits when user sends string. [user, message]

  setPixel - set pixel. [user, x, y, [r, g, b]]
  protectChunk - chunk (-un)protected. [user, x, y, newState]
  requestChunk - user requested chunk from server [user, x, y]
  paste - user has pasted something. [user, x, y, newData]
  setChunk - user erased something. [user, x, y, [r, g, b]]


  playerUpdate - emits when user updates self. [user]
  rankVerification - emits when user sends rankVerification. [user, rankToVerifcate]


  server:
  savedWorlds - worlds saved. []
  setRank - server has set rank for the user. [user]
  sentData - server sent message to user. [user]
  setPQuota - server set PQuota for user. [user]
  teleport - server teleported user. [user]
  setId - server set id for user. [user]
  maxCount - server sends to mod or admin max count of clients on world. [user]

  */
  constructor (options = {}) {
    super();

    const that = this;
    this.utils = {
      getKeyByValue(object, value) { 
        return Object.keys(object).find(key => object[key] === value); 
      },
      tools: {
        0: [1, "cursor"],
        1: [0, "move"],
        2: [0, "pippete"],
        3: [2, "eraser"],
        4: [0, "zoom"],
        5: [1, "bucket"],
        6: [2, "paste"],
        7: [0, "export"],
        8: [1, "line"],
        9: [2, "protect"],
        10: [2, "copy"]
      },
      rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      },
      hexToRgb(hex) {
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, function(m, r, g, b) {
          return r + r + g + g + b + b;
        });

        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        } : null;
      },
      random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      },
      randomString(length) {
         let result = '';
         let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
         for (let i = 0; i < length; i++) {
            result += characters.charAt(that.utils.random(0, characters.length));
         }
         return result;
      },
      sendToAll(message, rank = 0, world) {
        if(!message) return;
        if(world) {
          if(that.worlds[world]) for(let id in that.worlds[world].clients) if(that.worlds[world].clients[id].rank >= rank) that.worlds[world].clients[id].send(message);
        } else for(let name in that.worlds) for(let id in that.worlds[name].clients) if(that.worlds[name].clients[id].rank >= rank) that.worlds[name].clients[id].send(message);

      },
      compress(data, tileX, tileY, protection) {
        // copypasted, sorry ;-;
        var result = new Uint8Array(16 * 16 * 3 + 10 + 4);
        var s = 16 * 16 * 3;
        var compressedPos = [];
        var compBytes = 3;
        var lastclr = data[2] << 16 | data[1] << 8 | data[0];
        var t = 1;
        for(var i = 3; i < data.length; i += 3) {
          var clr = data[i + 2] << 16 | data[i + 1] << 8 | data[i];
          compBytes += 3;
          if(clr == lastclr) { ++t } else {
            if(t >= 3) {
              compBytes -= t * 3 + 3;
              compressedPos.push({
                pos: compBytes,
                length: t
              });
              compBytes += 5 + 3;
            }
            lastclr = clr;
            t = 1;
          }
        }
        if(t >= 3) {
          compBytes -= t * 3;
          compressedPos.push({
            pos: compBytes,
            length: t
          });
          compBytes += 5;
        }
        var totalcareas = compressedPos.length;
        var msg = new DataView(result.buffer);
        msg.setUint8(0, that.protocol.server.chunkLoad);
        msg.setInt32(1, tileX, true);
        msg.setInt32(5, tileY, true);
        msg.setUint8(9, protection);

        var curr = 10; // as unsigned8

        msg.setUint16(curr, s, true);
        curr += 2; // size of unsigned 16 bit ints

        msg.setUint16(curr, totalcareas, true);

        curr += 2; // uint16 size

        for(var i = 0; i < compressedPos.length; i++) {
          var point = compressedPos[i];
          msg.setUint16(curr, point.pos, true)
          curr += 2; // uint16 size
        }

        var di = 0;
        var ci = 0;
        for(var i = 0; i < compressedPos.length; i++) {
          var point = compressedPos[i];
          while(ci < point.pos) {
            msg.setUint8(curr + (ci++), data[di++]);
          }
          msg.setUint16(curr + ci, point.length, true);
          ci += 2; // uint16 size
          msg.setUint8(curr + (ci++), data[di++]);
          msg.setUint8(curr + (ci++), data[di++]);
          msg.setUint8(curr + (ci++), data[di++]);
          di += point.length * 3 - 3;
        }
        while(di < s) {
          msg.setUint8(curr + (ci++), data[di++]);
        }
        var size = compBytes + totalcareas * 2 + 10 + 2 + 2;
        return result.slice(0, size);
      },
      world: class {
        constructor(name) {
          this.name = name;
          
          this.latestId = 1;
          this.updates = [];
          this.clients = {};
          
          this.pquota = that.defaultPQuota.toString();
          this.doubleModQuota = true;
          
          this.modlogin = that.modlogin;
          this.motd = "";
          this.pass = "";
          this.bgcolor = "FFF";
          this.restricted = false;
        }
        loadProps() {
          this.restricted = that.manager.getProp(this.name, "restricted", "false") === "true";
          
          this.pass = that.manager.getProp(this.name, "pass", "");
          this.modlogin = that.manager.getProp(this.name, "modlogin", that.modlogin);
          this.pquota = that.manager.getProp(this.name, "pquota", that.defaultPQuota.toString());
          this.motd = that.manager.getProp(this.name, "motd", "");
          
          this.bgcolor = that.manager.getProp(this.name, "bgcolor", "FFF");
          
          this.doubleModQuota = that.manager.getProp(this.name, "doublemodquota", "true") !== "false";
          
        }
      },
      UpdateClock: class { // this thing is kina diffrent than in normal owop :P
        constructor() {
          this.updates = {};
          this.interval = setInterval(this.update.bind(this), this.updateInterval);
          this.playerSizeInfo = 4 + // player id
                                4 + // x
                                4 + // y
                                1 + // r
                                1 + // g
                                1 + // b
                                1;  // tool

          this.pixelSizeInfo =  4 + // player id
                                4 + // pixel x
                                4 + // y
                                1 + // r
                                1 + // g
                                1;  // b

          this.leftSizeInfo = 4;    // player id
        }
        update() {

          for(var worldName in this.updates) {
            let update = this.updates[worldName];
            let updates = [];
            while(update.playerUpdates.length || update.pixelUpdates.length || update.disconnectionsOfPlayers.length) {
              let playerUpdates = update.playerUpdates.splice(0, 255); // Math.pow(2, 8)-1
              let pixelUpdates = update.pixelUpdates.splice(0, 65535); // Math.pow(2, 16)-1
              let disconnectionsOfPlayers = update.disconnectionsOfPlayers.splice(0, 255); // Math.pow(2, 8)-1

              let updateSize = (1 + // that.protocol.server.worldUpdate
                                1 + // players update size
                                playerUpdates.length * this.playerSizeInfo + // player updates
                                2 + // pixels update size
                                pixelUpdates.length * this.pixelSizeInfo + // pixel updates
                                1 + // disconnections update size
                                this.leftSizeInfo * disconnectionsOfPlayers.length); // disconnections of players

              let updateArray = new Uint8Array(updateSize);
              let dv = new DataView(updateArray.buffer);

              dv.setUint8(0, that.protocol.server.worldUpdate); // that.protocol.server.worldUpdate

              dv.setUint8(1, playerUpdates.length); // players update size

              let offset = 2;


              for(let updateId = 0; updateId < playerUpdates.length; updateId++) { // player updates
                var user = playerUpdates[updateId];

                dv.setUint32(offset, user.id, true); // player id

                dv.setInt32(offset + 4, user.x, true); // x
                dv.setInt32(offset + 4 + 4, user.y, true); // y

                dv.setUint8(offset + 4 + 4 + 4, user.r); // r
                dv.setUint8(offset + 4 + 4 + 4 + 1, user.g); // g
                dv.setUint8(offset + 4 + 4 + 4 + 1 + 1, user.b); // b

                dv.setUint8(offset + 4 + 4 + 4 + 1 + 1 + 1, user.tool); // tool

                offset += this.playerSizeInfo;
              }


              dv.setUint16(offset, pixelUpdates.length, true); // pixels update size

              offset += 2;

              for(let updateId = 0; updateId < pixelUpdates.length; updateId++) {
                let pixel = pixelUpdates[updateId];

                dv.setUint32(offset, pixel.id, true); // player id

                dv.setInt32(offset + 4, pixel.x, true); // pixel x
                dv.setInt32(offset + 4 + 4, pixel.y, true); // y

                dv.setUint8(offset + 4 + 4 + 4, pixel.r); // r
                dv.setUint8(offset + 4 + 4 + 4 + 1, pixel.g); // g
                dv.setUint8(offset + 4 + 4 + 4 + 1 + 1, pixel.b); // b

                offset += this.pixelSizeInfo;
              }

              dv.setUint8(offset, disconnectionsOfPlayers.length, true); // disconnections of players update size

              offset += 1

              for(let updateId = 0; updateId < disconnectionsOfPlayers.length; updateId++) { // disconnections of players
                let leftId = disconnectionsOfPlayers[updateId];

                dv.setUint32(offset, leftId, true);
                offset += this.leftSizeInfo;
              }

              updates.push(updateArray);
            }
            
            let world = that.worlds[worldName];
            if(!world) continue; // it can happen if everyone will leave and there still will be update

            for(let i = 0; i < updates.length; i++) {
              let updateArray = updates[i];
              
              for(let id in world.clients) {
                world.clients[id].send(updateArray); //sends update to clients
              }
            }
            
            delete this.updates[worldName];
          }
        }

        getUpdObj(world) {
          world = world.toLowerCase();
          if (!this.updates[world]) {
            this.updates[world] = {
              playerUpdates: [],
              pixelUpdates: [],
              disconnectionsOfPlayers: []
            };
          }
          return this.updates[world]
        }

        doUpdatePlayer(world, client) {
          let upd = this.getUpdObj(world).playerUpdates;
          upd.push(client)
        }

        doUpdatePixel(world, pixelData) {
          let upd = this.getUpdObj(world).pixelUpdates;
          upd.push(pixelData)
        }

        doUpdatePlayerLeave(world, id) {
          let upd = this.getUpdObj(world).disconnectionsOfPlayers;
          upd.push(id)
        }
      },
      captcha: class {
        constructor(user) {
          this.user = user;
          if(!this.user) return;
          if(!this.user.ip) return;
          this.state = "waiting";
          this.whitelisted = false;
        }
        show() {
          if(this.whitelisted) return this.sendState("ok");
          
          let security = that.captchaSecurity;
          if (security < 0 || security > 3) security = 0;
          switch (security) {
            case 0:
              this.sendState("ok");
              break;
            case 1:
              if (Date.now() - that.captchaVerifiedIps[this.user.ip] < 1000 * 60 * 60 * 24) this.sendState("ok");
              else this.sendState("waiting");
              break;
            case 2:
              this.sendState("waiting");
              break;
          }
        }
        sendState(state) {
          this.state = state;
          this.user.send(new Uint8Array([that.protocol.server.captcha, that.captchaStates[state]]));
        }
        async onToken(message) {
          let key = message;
          let security = that.captchaSecurity;
          if (security < 0 || security > 3) security = 0;
          this.sendState("verifying");
          switch (security) {
            case 0:
              this.sendState("ok");
              break
            case 1: { //save ips (shows only once per 24 hours)
              let success = await this.verifyToken(key);
              if (success == true) {
                this.sendState("ok");
                that.captchaVerifiedIps[this.user.ip] = Date.now();
              } else {
                this.sendState("invaild");
                this.user.ws.close();
              }
              break;
            }
            case 2: { //don't save ip (always show)
              let success = await this.verifyToken(key);
              if (success === true) {
                this.sendState("ok")
              } else {
                this.sendState("invaild");
                this.user.ws.close();
              }
              break;
            }
          }
        }
        async verifyToken(key) {
          if (key === "LETMEINPLZ" + that.captchaBypass || key === "LETMEINPLZ" + that.adminlogin) {
            return true;
          }
          try {
            let response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${that.captchaKey}&response=${key}`); // fetch is newer
            response = await response.json();

            return response.success;
          } catch(e) {
            console.error(e);
            return false;
          }

          /*return new Promise(function(resolve, reject) {
            request(`https://www.google.com/recaptcha/api/siteverify?secret=${that.captchaKey}&response=${key}`, function(error, response, body) {
              if (error) {
                resolve(false)
                return;
              };
              body = body.replace(/\r/g, '');
              let jsonresponse = JSON.parse(body);
              resolve(jsonresponse.success);
            }.bind(resolve))
          })*/
        }
      },
      getIp(req) {
        return (req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(",")[0].replace('::ffff:', '');
      },
      outsideWorldBorder(x, y, raw = true) {
        if(!raw) {
          x = Math.floor(x/16);
          y = Math.floor(y/16);
        }
        return Math.abs(x) > that.worldBorder || Math.abs(y) > that.worldBorder;
      },
      outsideTpLimit(x, y) {
        return Math.abs(x) > that.tpLimit || Math.abs(y) > that.tpLimit;
      },
      player: class {
        constructor(ws, req) {
          this.muted = false;
          this.id = null;
          this.ip = that.utils.getIp(req);
          this.rank = 0;
          this.x = 0; this.y = 0;
          this.pquota = new Bucket(0, 0);
          this.cquota = new Bucket(0, 0);
          this.r = 0; this.g = 0; this.b = 0;
          this.stealth = false; // remove (A) or (M)
          this.nick = "";
          this.world = null;
          this.ws = ws;
          this.req = req;
          this.captcha = new that.utils.captcha(this);
        }
        get realX() {
          return this.x/16;
        }
        get realY() {
          return this.y/16;
        }
        get before() {
          let before = "";

          let isAdmin = this.stealth ? false : this.rank === 3;
          let isMod = this.stealth ? false : this.rank === 2;
          let isUser = this.rank <= 1 || this.stealth;
          let hasNick = !!this.nick.length;

          if(isAdmin) before += "(A) ";
          else if(isMod) before += "(M) ";
          else if(isUser) {
            if(hasNick) before += `[${this.id}] `;
            else before += this.id;
          }

          if(hasNick) before += this.nick;

          before = before.trim();
          return before;
        }
        _setRank(rank) {
          this.send(new Uint8Array([that.protocol.server.setRank, rank]))
        }
        setRank(rank) {
          this.rank = rank;
          this.cquota = rank === 0 || rank === 1 ? new Bucket(4, 6) :
                        rank === 2 ? new Bucket(10, 3) :
                        rank === 3 ? new Bucket(1000, 0) : new Bucket(0, 1000);
          
          this._setRank(rank);

          let pquota = this.world ? this.world.pquota.split(",") || that.defaultPQuota : that.defaultPQuota

          let pq = this.rank === 1 ? pquota :
                   this.rank === 2 ? [pquota[0], this.world.doubleModPQuota ? Math.floor(pquota[1]/2) : pquota[1]] :
                   this.rank === 3 ? [1000, 0] : [0, 1000];
          this.setPQuota(pq[0], pq[1]);

          if(rank === 2) this.send("Server: You are now a moderator. Do /help for a list of commands.");
          if(rank === 3) this.send("Server: You are now an administrator. Do /help for a list of commands.");
          if(rank >= 2) this.setMaxCount(that.maxClientsOnWorld);
          that.emit("setRank", this);
        }
        setMaxCount(maxCount) {
          let array = new Uint8Array(3)
          let dv = new DataView(array.buffer);
          dv.setUint8(0, that.protocol.server.maxCount);
          dv.setUint16(1, maxCount, true);
          this.send(array);
          that.emit("maxCount", this);
        }
        setPQuota(rate, per) {
          this.pquota = new Bucket(rate, per);
          let array = new Uint8Array(5)
          let dv = new DataView(array.buffer);
          dv.setUint8(0, that.protocol.server.setPQuota);
          dv.setUint16(1, rate, true);
          dv.setUint16(3, per, true);
          this.send(dv);
          that.emit("setPQuota", this);
        }
        setId(id) {
          this.id = id;
          let array = new Uint8Array(5);
          let dv = new DataView(array.buffer);
          dv.setUint8(0, that.protocol.server.setId);
          dv.setUint32(1, id, true);
          this.send(array);
          that.emit("setId", this);
        }
        send(data) {
          try {
            if(this.ws.readyState === 1) this.ws.send(data);
          } catch(e) {
            console.error(e);
          };
          that.emit("sentData", this, data);
        }
        teleport(x, y) {
          this.x = x
          this.y = y
          let array = new Uint8Array(9)
          let dv = new DataView(array.buffer);
          dv.setUint8(0, that.protocol.server.teleport);
          dv.setUint32(1, x, true);
          dv.setUint32(5, y, true);
          this.send(array);
          if(this.world) that.updateClock.doUpdatePlayer(this.world.name, {
             id: this.id,
             x: this.x,
             y: this.y,
             r: this.r,
             g: this.g,
             b: this.b,
             tool: this.tool
           })
          that.emit("teleport", this);
        }
      },
      Bucket,
      distance: function(x,y,x2,y2) {
        return Math.hypot(x2-x, y2-y)
      },
      getAllPlayers: function() {
        let users = [];
        for(let worldName in that.worlds) for(let userId in that.worlds[worldName].clients) users.push(that.worlds[worldName].clients[userId]);
        return users;
      },
      getAllPlayersWithIp: function(ip) {
        let users = [];
        for(let worldName in that.worlds) for(let userId in that.worlds[worldName].clients) if(that.worlds[worldName].clients[userId].ip === ip) users.push(that.worlds[worldName].clients[userId]);
        
        return users;
      }
    }
		this.started = Date.now();
		this.totalConnections = 0;
		// api thing this looks fucking ugly
		this.httpServer = http.createServer();

		this.app = express();

		let filesDirectory = "/dist/";

		function checkHttps(req, res, next) { // thx https://support.glitch.com/t/solved-auto-redirect-http-https/2392
		//return next();
      if(req.headers.host.includes("local")) return next();
		  if(req.get('X-Forwarded-Proto').includes("https")){
		    return next()
		  } else {
		    res.redirect('https://' + req.hostname + req.url);
		  }
		}
		this.app.all('*', checkHttps);
		this.funnySelfBanMessages = [
      "DayDun? Is that you? (I'd make this message appear for swedish IPs only but I'm too lazy)",
      "OWOT is actually pretty good!",
			"You almost did it! Keep banning yourself! Only 239 messages to go.",
			"Try playing Barony!",
      "https://youtu.be/wGlBwW7f5HA",
      "I don't think this was a good idea, dimden. I'll keep it so you can read these messages though.",
      "Wow you did it, you banned yourself. Congratulations, are you happy now?",
      "Did you know that the accounts are done? I have to finish the new OWOP client now.",
      "You probably feel smart by reading these messages, don't you? Well, you're banned now. :^)",
      // real^
			"ur mom gay //dimden",
			"you are really weird bro are you ok that you are banning yourself????? That's very illegal!",
			"MATHIAS377 IS BEST!!!!!",
			"dimden is admin since " + new Date(1586785345192),
      "dimden became mod ~" + new Date(1571318652317),
			"Infra drunk since -1923 0 0",
			"DayDun left from OWOP ~" + new Date(1553180105000),
			"dimden's retard list: 1. ludwig\n2. autoplayer\n3. Yui\ 4-Infinity: everyone else.",
			btoa("No you aren't clever if you read it.")
		];
		this.api = express();
		this.app.use("/api", this.api);
		this.api.get("/disconnectme", function(req, res) {
      let ip = that.utils.getIp(req);
      
			let playersToKick = that.utils.getAllPlayersWithIp(ip);

			for(let i = 0; i < playersToKick.length; i++) playersToKick[i].ws.close();
      
      res.json({
        hadEffect: !!playersToKick.length
      });
		});
    this.api.get("/stats", function(req, res) {
      res.json(that.pixelsPlaced);
    })
    this.api.get("/banme", function(req, res) {
			res.send("Nope, you're gonna need something else to get yourself banned.");
		});
		this.api.put("/banme", async function(req, res) {
			let ip = that.utils.getIp(req);

			let ipInfo = await that.ipsManager.getIp(ip) || {};
			if(ipInfo.banned > Date.now() || ipInfo.banned == -1) return res.send("Haha you thought I was going to keep giving you cool messages even when you're already banned? Think again, they are given to the most patient of self-banners.");

			await that.ipsManager.setSelfBanned(ip, Date.now() + 1000 * 60 * that.utils.random(1, 6), ipInfo.selfBans++ || 1);

			let playersToKick = that.utils.getAllPlayersWithIp(ip);

			for(let i = 0; i < playersToKick.length; i++) playersToKick[i].ws.close();

			res.send(that.funnySelfBanMessages[that.utils.random(0, that.funnySelfBanMessages.length-1)]);
		})

		this.api.get("/", async function(req, res) {
			let ip = that.utils.getIp(req);

			let ipInfo = await that.ipsManager.getIp(ip);

		  res.json({
				banned: ipInfo ? ipInfo.banned : 0,
				captchaEnabled: !!that.captchaSecurity,
				maxConnectionsPerIp: that.maxClientsPerIp,
				motd: that.motd,
				numSelfBans: ipInfo ? ipInfo.selfBans : 0,
				totalConnections: that.totalConnections,
				uptime: Date.now() - that.started,
				users: that.utils.getAllPlayers().length,
				yourConns: that.utils.getAllPlayersWithIp(ip).length,
				yourIp: ip
		  });
		});

		this.api.get("*", function(req, res) {
		  res.send(`"Unknown request"`);
		});

		this.app.get("*", function(req, res) {
		  let file = req.path;

		  if(file[0] === "/") file = file.slice(1);
		  if(file.endsWith("/")) file = file.slice(-1);

		  if(!file) file = "index.html";


		  fs.access(__dirname + filesDirectory + file, fs.constants.F_OK, function(err) {
		    if(err) file = "index.html"; // file not exists

		    res.sendFile(__dirname + filesDirectory + file);
		  });
		});

    this.wss = new WebSocket.Server({
      server: this.httpServer
    });
		this.httpServer.on('request', this.app);
		this.httpServer.listen(options.port ? options.port : process.env.PORT || 3000);


    // server
    this.worldBorder = 1048576; // Math.pow(2, 24) / 16
    this.tpLimit = 1000000;
    this.updateInterval = options.updateInterval || Math.floor(1000 / 30);
    this.TERMINATION = false;

    // database
    this.databasePath = options.databasePath || "./database.db";
    console.log(sqlite3.OPEN_READWRITE)
    this.db = new sqlite3.Database(this.databasePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    
    this.db.serialize(() => {
      this.db.run(`
        CREATE table if not exists ips (
          ip text primary key,
          banned integer default 0,
          whitelist boolean default false,
          restrictImmune boolean default false,
          muted boolean default false,
          selfBans integer default 0
        )
      `)
    });
    this.ipsManager = new IpsManager(this.db);
    this.chunksUpdateRate = options.chunksUpdateRate || 1000 * 60 * 5
    this.chunkdataPath = options.chunkdataPath || "./chunkdata/";
    this.manager = new Manager(this.chunksUpdateRate, this.chunkdataPath);
    this.manager.on("savedWorlds", () => {that.emit("savedWorlds")});

    // default config
    this.adminlogin = options.adminlogin;
    this.modlogin = options.modlogin;
    this.defaultPQuota = options.defaultPQuota || [64, 4];
    this.maxClientsPerIp = options.maxClientsPerIp || 3;
    this.maxClientsOnWorld = options.maxClientsOnWorld || 50;
    this.maxClientsOnServer = options.maxClientsOnServer || 500;
    this.appealLink = options.appealLink || that.utils.random(0,1) === 1 ? "https://discord.gg/k4u7ddk" : "https://discord.gg/PpZq7HB"; //LOL
    this.motd = options.motd || options.messageOfTheDay || "hi";
    
    // captcha
    this.captchaKey = options.captchaKey;
    this.captchaPublicKey = options.captchaPublicKey; //it's not used anywhere
    this.captchaBypass = options.captchaBypass ? that.captchaBypass : this.utils.randomString(60);
    this.captchaSecurity = options.captchaSecurity || 0;

    this.captchaEnabled = this.captchaKey && this.captchaSecurity > 0 && this.captchaSecurity < 3 && this.captchaBypass; //it's not used anywhere again

    this.captchaVerifiedIps = {};
    this.captchaStates = {
      waiting: 0,
      verifying: 1,
      verified: 2,
      ok: 3,
      invaild: 4
    }
    this.originCheck = options.originCheck ? options.originCheck.map(origin => origin.endsWith("/") ? origin.substr(0, origin.length-1) : origin) : [];
    // anti proxy
    this.antiProxyApiKey = options.antiProxyApiKey;
    this.antiProxyEnabled = options.antiProxyEnabled && !!this.antiProxyApiKey;
    this.antiProxy = this.antiProxyEnabled ? new proxy_check({
      api_key: this.antiProxyApiKey
    }) : undefined;

    if(typeof this.defaultPQuota !== "object" || this.defaultPQuota.length !== 2
    || isNaN(+this.defaultPQuota[0]) || isNaN(+this.defaultPQuota[1])) throw new Error("Bad PQuota.");
    if(!options.adminlogin|| !options.modlogin) throw new Error("You should set 'adminlogin' and 'modlogin' options.");
  
    // server things
    this.pixelsPlaced = {
      currentPixelsPlaced: 0,
      lastPushOn: 0,
      pixelsPlacedPerHour: []
    };
    setInterval(function() { // saves and resets upper thing
      that.pixelsPlaced.pixelsPlacedPerHour.push(that.pixelsPlaced.currentPixelsPlaced);
      
      that.pixelsPlaced.currentPixelsPlaced = 0;
    }, 1000 * 60 * 60);
    this.worlds = {};
    this.protocol = {
      server: {
          setId: 0,
          worldUpdate: 1,
          chunkLoad: 2,
          teleport: 3,
          setRank: 4,
          captcha: 5,
          setPQuota: 6,
          chunkProtected: 7,
          maxCount: 8
      },
      client: {
          rankVerification: 1, // rank
          //captcha: 6,
          requestChunk: 4 + // x
                        4,  // y
          protectChunk: 4 + // x
                        4 + // y
                        1 + // newstate
                        1,  // blank place
          setPixel: 4 + // x
                    4 + // y
                    1 + // r
                    1 + // g
                    1,  // b
          playerUpdate: 4 + // x
                        4 + // y
                        1 + // r
                        1 + // g
                        1 + // b
                        1,  //tool
          clearChunk: 4 + // x
                      4 + // y
                      1 + // r
                      1 + // g
                      1 + // b
                      2,  // blank place
          paste: 4 + // x
                 4 + // y
         16 * 16 * 3 // 768 data
      }
    }
    this.tokens = {
      worldVerificationCode: 25565,
      captchaCode: "CaptchA",
      chatCode: "\n"
    };
    this.commands = {
      help: {
        action: (user, args) => {
          let cmd = args[0];
          if (cmd) {
            let command = that.getCommand(cmd);
            if (command) {
              user.send(
                `Command: ${cmd}\nDescription: ${
                  command.description
                }\nAliases: ${
                  command.aliases.length ? command.aliases.join(" ") : "none"
                }`
              );
            } else {
              user.send("Server: Command not found.");
            }
          } else {
            let string = "Server: ";
            for (var commandName in this.commands) {
              if (user.rank >= this.commands[commandName].requiredRank) {
                string += commandName + " ";
              }
            }
            user.send(string.slice(0, -1));
          }
        },
        description: "Shows help",
        aliases: ["h", "commands"],
        requiredRank: 0
      },
      nick: {
        action: (user, args) => {
          let nick = args.join(" ").trim();
          if (user.rank < 3) {
            nick = nick
              .replace(/\n/gm, "")
              .slice(0, 16)
              .trim();
          }
          if (nick) {
            user.nick = nick;
            user.send(`Nickname set to: "${nick}"`);
          } else {
            user.nick = "";
            user.send("Nickname reset.");
          }
        },
        description: "Sets new nick.",
        aliases: ["nickname"],
        requiredRank: 0
      },
      tell: {
        action: (user, args) => {
          let u = user.world.clients[args[0]];

          let msg = args;
          msg.shift();
          msg = msg.join(" ");

          if (!u || !msg) {
            return user.send("Usage: /tell id message");
          }

          u.send(`-> ${user.id} tells you: ${msg}`);
          user.send(`-> you tell ${u.id}: ${msg}`);
        },
        requiredRank: 0,
        description: "PM other player.",
        aliases: ["msg"]
      },
      pass: {
        action: (user, args) => {
          let world = user.world;
          if (!world.pass || args[0] !== world.pass) return user.ws.close();

          if(user.rank === 0) user.setRank(1);
        },
        requiredRank: 0,
        description: "Unlock drawing with password.",
        aliases: ["password"]
      },
      modlogin: {
        action: (user, args) => {
          let world = user.world;
          let modlogin = args.join(" ");
          if (modlogin !== world.modlogin) return user.ws.close();

          user.setRank(2);
        },
        requiredRank: 0,
        description: "Login to moderator.",
        aliases: []
      },
      adminlogin: {
        action: (user, args) => {
          let adminlogin = args.join(" ");
          if (adminlogin !== this.adminlogin) return user.ws.close();

          user.setRank(3);
        },
        requiredRank: 0,
        description: "Login to administrator.",
        aliases: []
      },
      sayraw: {
        action: (user, args) => {
          let message = args.join(" ");
          if (!message) return user.send("Usage: /sayraw message");

          for (let clientId in user.world.clients)
            user.world.clients[clientId].send(message);
        },
        requiredRank: 3,
        description: "Sends raw message to all clients in world.",
        aliases: []
      },
      getid: {
        action: (user, args) => {
          let nick = args.join(" ");
          if (!nick) return user.send("Usage: /getid nick");
          let ids = [];
          for (let clientId in user.world.clients) {
            if (user.world.clients[clientId].nick === nick)
              ids.push(user.world.clients[clientId].id);
          }

          if (ids.length) {
            user.send(`Found ${ids.length} id${ids.length === 1 ? "" : "s"}: ${ids.join(" ")}`);
          } else {
            user.send("No user found with the given nickname.");
          }
        },
        requiredRank: 3,
        description: "Gets id of client using nick",
        aliases: []
      },
      eval: {
        action: (user, args) => {
          let msg = args.join(" ");
          msg = msg.trim();
          try {
            let output = String(eval(msg));

            user.send(output);
            console.log(output);
          } catch (e) {
            user.send("Error occured. Look into the console.");
            console.log("[ERROR]:" + e.name + ":" + e.message + "\n" + e.stack);
          }
        },
        requiredRank: 3,
        description: "Evals JS",
        aliases: ["execute"]
      },
      doas: {
        action: (user, args) => {
          let id = parseInt(args[0]);
          let cmd = args[1];

          if (isNaN(id) || !cmd)
            return user.send("Usage: /doas id, command, optionally args");

          if (cmd === "doas") return user.send("Why do you want to do loop?");

          let userToBind = user.world.clients[id];

          if (!userToBind) return user.send("User not found");

          let commandToBind = this.getCommand(cmd);

          if (!commandToBind) return user.send("Command not found!");

          let argsToBind = args;
          argsToBind.shift();
          argsToBind.shift();

          try {
            commandToBind.action(userToBind, args, `${cmd} ${argsToBind.join(" ")}`.trim(), cmd);
            user.send("Command completed successfully");
          } catch (e) {
            user.send("An error occurred while executing the command on user. Contact with administrator.");
            console.warn("An error occurred while executing " + cmd +" command on user:\n" + e);
          }
        },
        requiredRank: 3,
        description: "Executes the command as a different player",
        aliases: []
      },
      disconnect: {
        action: (user, args) => {
          user.send("Disconnected.");
          user.ws.close();
        },
        requiredRank: 0,
        description: "Disconnects you.",
        aliases: ["close"]
      },
      save: {
        action: async (user, args) => {
          await that.manager.updateDatabase();
          user.send("Saved worlds")
        },
        requiredRank: 3,
        description: "Saves all worlds.",
        aliases: ["saveworlds"]
      },
      whois: {
        action: (user, args) => {
          let id = args[0];
          let u = user.world.clients[id];

          if (!id) return user.send("Usage: /whois id");

          if (id && !u) return user.send("Client not found.");

          if (u)
            user.send(
              `Client informations:\n` +
                `-> id: ${u.id}\n` +
                `-> nick: ${u.nick}\n` +
                `-> ip: ${u.ip}\n` +
                `-> rank: ${u.rank}\n` +
                `-> tool: ${u.tool}\n` +
                `-> color: ${u.r} ${u.g} ${u.b}\n` +
                `-> x, y: ${u.realX}, ${u.realY}\n` +
                `-> stealth: ${u.stealth}`
            );
        },
        requiredRank: 2,
        description: "Sends info about an client.",
        aliases: []
      },
      serverinfo: {
        action: (user, args) => {
          let memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;
          let memoryFree = Math.round(os.freemem() / 1024 / 1024 * 100) / 100;
          let totalMemory = Math.round(os.totalmem() / 1024 / 1024 * 100) / 100

          let totalChunks = 0;
          let totalProtections = 0;

          for(let name in that.manager.chunkCache) totalChunks += Object.keys(that.manager.chunkCache[name]).length;
          for(let name in that.manager.loadedProts) totalProtections += Object.keys(that.manager.loadedProts[name].hashTable).length;

          user.send(`Memory data can be inaccurate\nTotal Memory: ${totalMemory}mb\nMemory usage: ${memoryUsage}mb\nFree memory: ${memoryFree}mb\nLoaded chunks + protections: ${totalChunks} + ${totalProtections} = ${totalChunks + totalProtections}`)

        },
        requiredRank: 3,
        description: "Sends info about user.",
        aliases: []
      },
      tellraw: {
        action: (user, args)=>{
          let u = user.world.clients[args[0]];

          let msg = args;
          msg.shift();
          msg = msg.join(" ");

          if (!u || !msg) {
            user.send("Usage: /tellraw id message");
          }

          u.send(msg);
          user.send(`-> you tell ${u.id}: ${msg}`);
        },
        requiredRank: 3,
        description: "Tells raw message to client.",
        aliases: []
      },
      setprop: {
        action: (user, args) => {
          let property = args[0];
          let value = args; value.shift(); value = value.join(" "); value = value || ""

          if(!property) return user.send("Usage: /setprop property (value - if you want remove value then don't put value)");

          that.manager.setProp(user.world.name, property, value);

          if(typeof user.world[property] === "string") user.world[property] = value;

          that.utils.sendToAll(value.length ? `DEVSet world(${user.world.name}) property ${property} to ${value}` : `DEVRemoved world(${user.world.name}) property ${property}`, 3);
        },
        requiredRank: 3,
        description: "Sets property of world like motd, pquota, pass, modlogin, restricted.",
        aliases: []
      },
      getprop: {
        action: (user, args) => {
          let property = args[0];

          if(!property) return user.send("Usage: /getprop property");

          user.send(that.manager.getProp(user.world.name, property, "null"));
        },
        requiredRank: 3,
        description: "Sets property of world like motd, pquota, pass, modlogin, restricted.",
        aliases: []
      },
      restrict: {
        action: (user, args) => {
          let restricted = args[0];
          if(typeof restricted !== "string") user.send("You can also use: /restrict true/false");

          restricted = restricted ? restricted === "true" : !user.world.restricted;

          that.manager.setProp(user.world.name, "restricted", restricted);

          user.world.restricted = restricted;

          that.utils.sendToAll(`DEVWorld ${user.world.name} is ${restricted ? "now restricted!" : "not restricted anymore!"}`, 2);
        },
        requiredRank: 2,
        description: "Enables/disabled restrict in world.",
        aliases: []
      },
      setrank: {
        action: (user, args) => {
          let id = parseInt(args[0]);
          let rank = parseInt(args[1]);
          let u = user.world.clients[id];

          if(!id || !rank || rank > 3 || rank < 0) return user.send("Usage: /setrank id rank");
          if(!u) return user.send("User not found!");

          u.setRank(rank);
          user.send(`Set rank ${rank} for user ${id}`);
        },
        requiredRank: 3,
        description: "Sets an user rank.",
        aliases: []
      },
      whitelist: {
        action: async (user, args) => {
          let operation = args[0]; operation = operation ? operation.toLowerCase() : undefined;

          if(operation === "list") {
            let whitelisted = await that.ipsManager.getAllWhitelisted();

            if(whitelisted.length) {
              let string = `Found ${whitelisted.length} whitelisted ip${whitelisted.length === 1 ? "" : "s"}:\n`;

              for(let i = 0; i < whitelisted.length; i++) {
                string += whitelisted[i].ip + ((i+1) % 3 === 0 ? "\n" : " ");
              }

              user.send(string)
            } else {
              user.send("There is nothing in the whitelist.")
            }

          } else if(operation === "add") {
            let ip = args[1];

            if(!ip) return user.send("Usage: /whitelist add ip");

            if(ip.split(".").length !== 4) return user.send("It's not ip!");

            await that.ipsManager.setWhitelist(ip, 1);

            user.send("Ip was added into whitelist.")

          } else if(operation === "remove") {
            let ip = args[1];

            if(!ip) return user.send("Usage: /whitelist remove ip");

            if(ip.split(".").length !== 4) return user.send("It's not ip!");

            await that.ipsManager.setWhitelist(ip, 0);

            user.send("Ip was removed from whitelisted.")
          } else {
            user.send("Usage: /whitelist add/remove/list");
          }

        },
        requiredRank: 3,
        description: "Removes/adds to whitelst ip or shows full list of whitelisted ips",
        aliases: []
      },
      tp: {
        action: (user, args) => {
          if(args.length === 1) {
            // id
            let id = parseInt(args[0]);
            let u = user.world.clients[id];
            if(!id) return user.send("Usage: Teleport to player / teleport player to x y / teleport to x y (/tp [id | x] <  x | y> <y>)");
            if(!u) return user.send("User not found!");

            user.teleport(u.realX, u.realY);
          } else if(args.length === 2) {
            // x y
            user.teleport(+args[0], +args[1]);

          } else if(args.length === 3) {
            // id x y
            let id = parseInt(args[0]);
            let u = user.world.clients[id];
            if(!id) return user.send("Usage: Teleport to player / teleport player to x y / teleport to x y (/tp [id | x] <  x | y> <y>)");
            if(!u) return user.send("User not found!");

            u.teleport(+args[1], +args[2]);
          } else {
            user.send("Usage: Teleport to player / teleport player to x y / teleport to x y (/tp [id | x] <  x | y> <y>)")
          }
        },
        description: "Teleport to player / teleport player to x y / teleport to x y (/tp [id | x] <  x | y> <y>)",
        requiredRank: 2,
        aliases: ["teleport"]
      },
      kick: {
        action: (user, args) => {
          let idOrIp = args[0];
          if(!idOrIp) return user.send("Usage: /kick id/ip");

          let isIp = idOrIp.split(".").length === 4;
          let u = user.world.clients[idOrIp];

          if(!isIp && !u) return user.send("User not found");

          let ip = isIp ? idOrIp : u.ip;

          let playersToKick = that.utils.getAllPlayersWithIp(ip);

          for(let i = 0; i < playersToKick.length; i++) playersToKick[i].ws.close();

          that.utils.sendToAll(`DEVKicked users with ip "${ip}".`, 2);
        },
        description: "Kicks player. (/kick id)",
        requiredRank: 2,
        aliases: []
      },
      ids: {
        action: (user, args) => {
          let string = "Total online: " + that.utils.getAllPlayers().length + "\n";
          
          for(let name in that.worlds) {
            let users = Object.keys(that.worlds[name].clients); // no detailed informations needed

            string += `World ${name} found ${users.length} user${users.length === 1 ? "" : "s"}\n`;

            string += users.join(", ");

            string+="\n\n";
          }
          string = string.slice(0, -2);
          user.send(string);
        },
        description: "Gives you full list of clients",
        requiredRank: 2,
        aliases: ["users", "list", "totalonline"]
      },
      setworldpass: {
        action: (user, args) => {
          let pass = args.join(" ");
          user.world.pass = pass;
          that.manager.setProp(user.world.name, "pass", pass);

          that.utils.sendToAll(`DEVSet world (${user.world.name}) password to "${pass}"`, 2);
        },
        description: "Sets world password.",
        requiredRank: 2,
        aliases: ["setworldpassword"]
      },
      setpbucket: {
        action: (user, args) => {
          let rate = +args[0];
          let per = +args[1];
          
          if(!rate || !per) return user.send("Usage: /setpbucket rate per");
          
          user.world.pquota = rate+","+per;
          that.manager.setProp(user.world.name, "pquota", rate+","+per);

          that.utils.sendToAll(`DEVSet world (${user.world.name}) pixel bucket to "${rate} ${per}"`, 2);
        },
        description: "Sets world pixel bucket.",
        requiredRank: 2,
        aliases: ["setpixelbucket", "setworldpbucket", "setworldpixelbucket"]
      },
      mute: {
        action: async (user, args) => {
          let idOrIp = args[0];
          if(!idOrIp) return user.send("Usage: /mute id/ip");

          let isIp = idOrIp.split(".").length === 4;
          let u = user.world.clients[idOrIp];

          if(!isIp && !u) return user.send("User not found");

          let ip = isIp ? idOrIp : u.ip;

          await that.ipsManager.setMuted(ip, 1);
          let playersToMute = that.utils.getAllPlayersWithIp(ip);

          for(let i = 0; i < playersToMute.length; i++) {
            playersToMute[i].muted = true;
            playersToMute[i].send("Sever: You are muted now.")
          }
          that.utils.sendToAll(`DEVUser with ip ${ip} is muted now.`, 2);
        },
        description: "Mutes user.",
        requiredRank: 2,
        aliases: []
      },
      ban: {
        action: async (user, args) => {
          if(args.length < 1) return user.send("Usage: /ban id/ip time(default perm) timeunit(default seconds)");
          let isIp = args[0].split(".").length === 4;
          let u = user.world.clients[args[0]];

          if(!u && !isIp) return user.send("User not found");

          let time = args[1];
          let timeUnit = args[2];

          let ip = isIp ? args[0] : u.ip

          if(!time) time = "";

          if(time.toLowerCase() === "perm" || !time) time = -1;
          else {
            let banEnd = moment();
            banEnd.add(time.length ? time : 60, timeUnit);
            time = banEnd.valueOf();
          }

          await that.ipsManager.setBanned(ip, time);
          let playersToBan = that.utils.getAllPlayersWithIp(ip);

          for(let i = 0; i < playersToBan.length; i++) playersToBan[i].ws.close();
          that.utils.sendToAll(`DEVBanned ip ${ip}`, 3);
        },
        description: "Bans user.",
        requiredRank: 3,
        aliases: []
      },
      unban: {
        action: async (user, args) => {
          let ip = args[0];

          if(!ip) return user.send("Usage: /unban ip");
          if(ip.split(".").length !== 4) return user.send("It's not ip!");

          await that.ipsManager.setBanned(ip, 0);

          that.utils.sendToAll(`DEVUnbanned ip ${ip}`, 3);
        },
        description: "Unbans ip.",
        requiredRank: 3,
        aliases: []
      },
      bans: {
        action: async (user, args) => {
          let bans = await that.ipsManager.getAllBanned();

          if (bans.length) {
            let string = `Found ${bans.length} banned ip${bans.length === 1 ? "" : "s"}:\n`;

            for (let i = 0; i < bans.length; i++) {
              string += bans[i].ip + ((i + 1) % 3 === 0 ? "\n" : " ");
            }

            user.send(string)
          } else {
            user.send("There is nothing in the ban list.")
          }
        },
        description: "Shows bans list",
        requiredRank: 3,
        aliases: []
      },
      unmute: {
        action: async (user, args) => {
          let idOrIp = args[0];
          if(!idOrIp) return user.send("Usage: /unmute id/ip");

          let isIp = idOrIp.split(".").length === 4;
          let u = user.world.clients[idOrIp];

          if(!isIp && !u) return user.send("User not found");

          let ip = isIp ? idOrIp : u.ip;

          await that.ipsManager.setMuted(ip, 0);
          let playersToMute = that.utils.getAllPlayersWithIp(ip);

          for(let i = 0; i < playersToMute.length; i++) {
            playersToMute[i].muted = false;
            playersToMute[i].send("Sever: You aren't muted anymore.")
          }
          that.utils.sendToAll(`DEVUser with ip ${ip} isn't muted anymore.`, 2);
        },
        description: "Unmutes user.",
        requiredRank: 2,
        aliases: []
      },
      stealth: {
        action: (user, args) => {
          let state = args[0];
          if(!state) user.send("You can also use: /stealth true/false");
          user.stealth = typeof state === "string" ? state === "true" : !user.stealth;
        },
        description: "Removes (A) or (M).",
        requiredRank: 2,
        aliases: []
      },
      tpall: {
        action: (user, args) => {
          for(let id in user.world.clients) {
            if(id == user.id) continue;
            user.world.clients[id].teleport(user.realX, user.realY);
            user.world.clients[id].send("You were teleported.");
          }
          user.send("Teleported everyone in world to your position.");
        },
        description: "Teleports everyone to your position.",
        requiredRank: 2,
        aliases: []
      },
      ao: {
        action: (user, args) => {
          let msg = args.join(" ");

          that.utils.sendToAll(`(${user.world.name}) ${user.nick || user.id}: ${msg}`, 2);
        },
        description: "Allows chatting with other admins/mods cross worlds.",
        requiredRank: 2,
        aliases: ["devchat"]
      },
      reload: {
        action: (user, args) => {
          user.world.loadProps();
          that.utils.sendToAll(`DEVReloaded properties of world ${user.world.name}`, 2);
        },
        description: "Reloads world properties",
        requiredRank: 3,
        aliases: []
      },
      kickall: {
        action: (user, args) => {
          let operation = args[0];
          
          if(!operation) return user.send("Usage: /kickall all/world");
          
          if(operation === "all") {
            let allPlayers = that.utils.getAllPlayers();
            for(let i = 0; i < allPlayers.length; i++) {
              if(allPlayers[i].rank < user.rank) allPlayers[i].ws.close();
            }
            that.utils.sendToAll(`DEVKicked all users.`, 3);
          } else if(operation === "world") {
            let allPlayers = user.world.clients;
            for(let i in allPlayers) {
              if(allPlayers[i].rank < user.rank) allPlayers[i].ws.close();
            }
            
            that.utils.sendToAll(`DEVKicked all users from world ${user.world.name}.`, 3);
          } else {
            user.send("Usage: /kickall all/world");
          }
        },
        description: "Kicks all players from world/server",
        requiredRank: 3,
        aliases: []
      },
      about: {
        action: (user) => {
          user.send("This server was created by FP#9390 (FunPoster or system2k), mathias377#3326, dimden#1877 (eff the cops or fluffy boi).\nNodeJS OWOP server version: " + serverVersion)
        },
        description: "About server",
        requiredRank: 0,
        aliases: []
      }
    };
    this.getCommand = function getCommand(cmd) {
      if (typeof cmd !== "string") return;

      if (this.commands[cmd]) return this.commands[cmd];

      for (var i in this.commands)
        if (this.commands[i].aliases)
          if (this.commands[i].aliases.includes(cmd)) return this.commands[i];
    };

    this.getTile = async function(worldName, x, y) {
      let world = that.worlds[worldName];
      if(!world) return;

      let tile = await that.manager.getChunk(worldName, x, y);
      if(!tile) {
        let color = that.utils.hexToRgb(world.bgcolor) || {r: 255, g: 255, b: 255};
        
        tile = new Uint8Array(16 * 16 * 3);
        for(var i = 0; i < 16 * 16 * 3;) {
          tile[i++] = color.r;
          tile[i++] = color.g;
          tile[i++] = color.b;
        }
      }

      let isProtected = that.manager.chunkIsProtected(worldName, x, y);
      
      return that.utils.compress(tile, x, y, isProtected);
    }

    this.exit = async function() {
      that.emit("exiting");
      console.log("Saving worlds...");
      that.TERMINATION = true;

       for(let worldName in that.worlds) {
        for(let clientId in that.worlds[worldName].clients) {
           try { // because user can be closed before by message event
            that.worlds[worldName].clients[clientId].send("Server is closing, try joining later.");
            that.worlds[worldName].clients[clientId].ws.terminate();
          } catch(e) {};
        }
      }

      clearInterval(that.updateClock.updateInterval);

      await that.manager.closeDatabase();

      console.log("Exiting");
      process.exit();
    }
    this.updateClock = new this.utils.UpdateClock();
    this.wss.on("connection", async (ws, req) => {
      if(that.TERMINATION) {
        user.send("Server is closing, try joining later.");
        user.ws.terminate();
        return;
      }
      if(typeof that.originCheck[0] === "string") {
        if(!that.originCheck.includes(req.headers.origin)) {
          ws.close();
          return;
        }
      }
      let user = new that.utils.player(ws, req);
      user.info = await that.ipsManager.getIp(user.ip) || {}; // I'm thinking about if it should be "_info" instead of "info"
      
      user.muted = !!user.info.muted;
      user.captcha.whitelisted = !!user.info.whitelist;
      user.banned = user.info.banned;
      user.restrictImmune = !!user.info.restrictImmune;
      user.selfBans = user.info.selfBans;
      
      that.emit("open", user);

      if(that.utils.getAllPlayersWithIp(user.ip).length >= that.maxClientsPerIp) {
        user.send(`Sorry, but you have reached the maximum number of simultaneous connections, (${that.maxClientsPerIp}).`)
        user.ws.close();
      }
      if(that.utils.getAllPlayers().length >= that.maxClientsOnServer) {
        user.send("Server is full! Try joining later again.")
      }
      
      let banInfo = user.banned;
      if (banInfo > 0 || banInfo === -1) {
        if (banInfo === -1) {
          user.send("You are banned appeal for unban on: " + that.appealLink);
          user.ws.close();
          return;
        } else if (moment().isBefore(banInfo)) {
          let banEnd = moment(banInfo);
          let difference = moment.duration(banEnd.diff(moment()))

          let info = {
            years: difference.years(),
            days: difference.days(),
            hours: difference.hours(),
            minutes: difference.minutes(),
            seconds: difference.seconds()
          }

         let string = "";
         for (let timeUnit in info) {
           let value = info[timeUnit]
           if (value !== 0) {
             string += `${value} ${value === 1 ? timeUnit.slice(0, -1) : timeUnit} `
           }
          }
          string = string.slice(0, string.length - 1);
          user.send("You are banned for " + string + "\nAppeal for unban on: " + that.appealLink);
          user.ws.close();
          return;
        }
      }
      if(that.antiProxyEnabled && !user.whitelist) {
        let result = await that.antiProxy.check(user.ip, {vpn: true});
        if(!result || result.status.toLowerCase() === "denied" || result.error || !result[user.ip]) {
          user.send("Proxy checking error.");
          user.ws.close();
          return console.error("Anti proxy error.");
        }
        if(result[user.ip].proxy === "yes") {
          user.ws.close();
          await that.ipsManager.setBanned(user.ip, -1);
          return;
        }
      }
      user.captcha.show();

			that.totalConnections++; // it can be also in 2 other places

      ws.on("close", () => {
        that.emit("close", user)
        let userWorld = user.world;
        if(userWorld) {
          that.updateClock.doUpdatePlayerLeave(user.world.name, user.id);

          delete userWorld.clients[user.id];

          if(Object.keys(userWorld.clients).length === 0 || !userWorld.name) {
            if(that.TERMINATION) return;
            that.manager.worldUnload(userWorld.name);
            delete that.worlds[userWorld.name];
          }
        }
      });
      ws.on("message", async msg => {
        that.emit("rawMessage", user, msg);
        if(that.TERMINATION) {
          user.send("Server is closing.");
          user.ws.terminate();
          return;
        }

        let data = new Uint8Array(msg)
        let dv = new DataView(data.buffer)
        let len = msg.length;
        let isBinary = (typeof msg == "object");

        if(user.captcha.state === "waiting" && !isBinary && msg.startsWith(this.tokens.captchaCode)) {
          user.captcha.onToken(msg.slice(this.tokens.captchaCode.length));
          that.emit("captcha", user)
        } else if(user.world && isBinary) {
          switch(len) {
            case that.protocol.client.rankVerification: {
              let clientRank = dv.getUint8(0);
              if(clientRank > user.rank) return user.ws.close();
              that.emit("rankVerification", user, clientRank);
              break;
            }
            case that.protocol.client.requestChunk: {
              let chunkX = dv.getInt32(0, true);
              let chunkY = dv.getInt32(4, true);
              if(that.utils.outsideWorldBorder(chunkX, chunkY)) return;
              let chunk = await that.getTile(user.world.name, chunkX, chunkY);
              
              that.emit("requestChunk", user, chunkX, chunkY, chunk);
              
              user.send(chunk);
              
              break;
            }


            case that.protocol.client.protectChunk: {
              if(user.rank < 2) return user.ws.close();

              let chunkX = dv.getInt32(0, true);
              let chunkY = dv.getInt32(4, true);
              //console.log(chunkX, chunkY)
              if(that.utils.outsideWorldBorder(chunkX, chunkY)) return;

              let newState = !!dv.getUint8(8);


              let array = new Uint8Array(10);
              let dv2 = new DataView(array.buffer);
              dv2.setUint8(0, that.protocol.server.chunkProtected);
              dv2.setInt32(1, chunkX, true);
              dv2.setInt32(5, chunkY, true);
              dv2.setUint8(9, newState);

              for(var id in user.world.clients) user.world.clients[id].send(array);

              await that.manager.setChunkProtection(user.world.name, chunkX, chunkY, newState);

              that.emit("protectChunk", user, chunkX, chunkY, newState);
              break;
            }
            case that.protocol.client.setPixel: {
              if(!user.pquota.canSpend(1) || user.rank === 0) break;
              let x = dv.getInt32(0, true);
              let y = dv.getInt32(4, true);
              if(that.utils.outsideWorldBorder(x, y, false)) break;
              let r = dv.getUint8(8);
              let g = dv.getUint8(9);
              let b = dv.getUint8(10);

              if((that.utils.distance(user.realX, user.realY, x, y) < 48 && (!that.manager.chunkIsProtected(user.world.name, Math.floor(x/16), Math.floor(y/16)) || user.rank >= 2)) || user.rank === 3) {
                that.updateClock.doUpdatePixel(user.world.name, {
                  id: user.id,
                  x,
                  y,
                  r,
                  g,
                  b
                });
                
                this.pixelsPlaced.currentPixelsPlaced++;
                this.pixelsPlaced.lastPushOn = Date.now();
                
                await that.manager.setPixel(user.world.name, x, y, r, g, b);
                that.emit("setPixel", user, x, y, [r, g, b]);
              } else {
                // warning level
              }
              break;
            }
            case that.protocol.client.playerUpdate: {
              let x = dv.getInt32(0, true);
              let y = dv.getInt32(4, true);
              
              if(that.utils.outsideTpLimit(x/16, y/16) && that.utils.distance(user.realX, user.realY, x/16, y/16) > 1000 && user.rank < 2) {
                x = user.x;
                y = user.y;
                user.teleport(x/16, y/16);
              }

              let r = dv.getUint8(8);
              let g = dv.getUint8(9);
              let b = dv.getUint8(10);

              let tool = dv.getUint8(11);
              
              if(that.utils.tools[tool]) {
                tool = 0;
              } else if(that.utils.tools[tool][0] > user.rank) {
                tool = 0;
              }

              user.x = x;
              user.y = y;

              user.r = r;
              user.g = g;
              user.b = b;

              user.tool = tool;

              that.updateClock.doUpdatePlayer(user.world.name, {
                id: user.id,
                x,
                y,
                r,
                g,
                b,
                tool
              })
              that.emit("playerUpdate", user);
              break;
            }
            case that.protocol.client.clearChunk: {
              if(user.rank < 2) return user.ws.close();

              let chunkX = dv.getInt32(0, true);
              let chunkY = dv.getInt32(4, true);

              if(that.utils.outsideWorldBorder(chunkX, chunkY)) return;
              let r = dv.getUint8(8);
              let g = dv.getUint8(9);
              let b = dv.getUint8(10);


              let newData = new Uint8Array(16 * 16 * 3);
              for (let i = 0; i < 16 * 16 * 3;) {
                newData[i++] = r;
                newData[i++] = g;
                newData[i++] = b;
              }

              await that.manager.setChunk(user.world.name, chunkX, chunkY, newData);

              let tile = await that.getTile(user.world.name, chunkX, chunkY);
              for(let id in user.world.clients) user.world.clients[id].send(tile);
              that.emit("setChunk", user, chunkX, chunkY, [r, g, b]);
              break;
            }
            case that.protocol.client.paste: {
              if(user.rank < 2) return user.ws.close();
              let chunkX = dv.getInt32(0, true);
              let chunkY = dv.getInt32(4, true);
              if(that.utils.outsideWorldBorder(chunkX, chunkY)) return;

              let newData = new Uint8Array(16 * 16 * 3);
              for(let i = 0; i < 16 * 16 * 3; i++) {
                newData[i] = dv.getUint8(i+8);
              }

              await that.manager.setChunk(user.world.name, chunkX, chunkY, newData);

              let tile = await that.getTile(user.world.name, chunkX, chunkY);
              for(var id in user.world.clients) user.world.clients[id].send(tile);
              that.emit("paste", chunkX, chunkY, newData);
              break;
            }
          }
        } else if(!user.world && isBinary) { // world verification
          let worldVerificationCode = dv.getUint16(len - 2, true); // biggest possible Math.pow(2,16)-1 === 65535
          if(this.tokens.worldVerificationCode !== worldVerificationCode) return user.ws.close();

          if(len > 2 && len - 2 <= 24) {
            let str = "";

            for(let i = 0; i < data.length - 2; i++) str += String.fromCharCode(data[i]); // reading world from message

            str = str.replace(/[^a-zA-Z0-9\._]/gm, "").trim().toLowerCase(); // replacing not valid characters

            if(!str) str = "main"; // default world is main

            user.world = that.worlds[str];

            if(!user.world) {
              await that.manager.worldInit(str);

              user.world = that.worlds[str] = new that.utils.world(str);
              
              user.world.loadProps();
            }
            if(Object.keys(user.world.clients).length >= that.maxClientsOnWorld) {
              user.send("World is full! Try joining later.");
              user.ws.close();
              return;
            }
            user.setId(user.world.latestId++);

            if(user.world.pass || (user.world.restricted && !user.restrictImmune)) {
              user.setRank(0);
              if(user.world.restricted && !user.restrictImmune) user.send("Server: This world is restricted. To unlock drawing ask moderator to give you permission.");
              else if(user.world.pass) user.send("Server: This world has a password set. Use '/pass PASSWORD' to unlock drawing.");
            } else {
              user.setRank(1);
            }

            that.updateClock.doUpdatePlayer(user.world.name, {
              id: user.id,
              x: 0,
              y: 0,
              r: 0,
              g: 0,
              b: 0,
              tool: 0
            })

            for(let id in user.world.clients) {
              let u = user.world.clients[id];
              that.updateClock.doUpdatePlayer(user.world.name, {
                id: u.id,
                x: u.x,
                y: u.y,
                r: u.r,
                g: u.g,
                b: u.b,
                tool: u.tool
              })
            }

            if(user.world.motd) user.send(user.world.motd);

            user.world.clients[user.id] = user;
            that.emit("join", user)
          }
        } else if(!isBinary && user.world) {
          if(msg.endsWith(this.tokens.chatCode)) {
            if(!user.cquota.canSpend(1)) return;
            msg = msg.slice(0, -1);
            that.emit("message", user, msg)
            if(msg.startsWith("/")) {
              msg = msg.slice(1);

              let cmdName = msg.split(" ")[0].toLowerCase();

              let args = msg.split(" "); args.shift();
              let command = that.getCommand(cmdName);

              if(command) {
                if(user.rank >= command.requiredRank) {
                  try {
                    command.action(user, args, msg, cmdName);
                  } catch(e) {
                    user.send("An error occurred while executing the command. Contact with administrator.");
                    console.warn("An error occurred while executing " + cmdName + " command:\n" + e);
                  }
                } else {
                  user.send("You do not have sufficient permissions to perform this command!");
                }
              }
              return;
            }
            if(user.muted) return user.send("You are muted.");
            if(user.rank <= 1 && msg.length > 128) msg = msg.slice(0, 128);
            if(user.rank === 2 && msg.length > 512) msg = msg.slice(0, 512);
            msg = msg.trim();
            if(!msg) return;

            that.utils.sendToAll(user.before + ": " + msg, 0, user.world.name);
          }
        }
      });
    })
  }
}

module.exports = {
  Server,
  Bucket,
  btoa,
  atob
};
