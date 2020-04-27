class IpsManager {
  constructor(db) {
    this.db = db;
  }
  createIpTable(ip, banned = 0, whitelist = false, restrictImmune = false, muted = false, selfBans = 0) {
    return new Promise (resolve => {
      this.db.run("INSERT OR REPLACE INTO ips (ip, banned, whitelist, restrictImmune, muted, selfBans) VALUES (?, ?, ?, ?, ?, ?)", [ip, banned, whitelist+0, restrictImmune+0, muted+0, selfBans], function(err) {
        resolve(!err);
      })
    });
    
    //this.db.prepare("insert or replace into ips (ip, banned, whitelist, restrictImmune, muted, selfBans) values (?, ?, ?, ?, ?, ?)").run(ip, banned, whitelist+0, restrictImmune+0, muted+0, selfBans);
  }
  setBanned(ip, value) {
    value = +value;
    return new Promise(async resolve => {
      if(!await this.getIp(ip)) {
        await this.createIpTable(ip, value);
        return resolve(true);
      }
      this.db.run("UPDATE ips SET banned = ? WHERE ip = ?", [value, ip], function(err) {
        resolve(!err)
      });
    });
  }
  setWhitelist(ip, value) {
    value = +value;
    return new Promise(async resolve => {
      if(!await this.getIp(ip)) {
        await this.createIpTable(ip, null, value);
        return resolve(true);
      }
      this.db.run("UPDATE ips SET whitelist = ? WHERE ip = ?", [value, ip], function(err) {
        resolve(!err)
      });
    });
  }
  setRestrictImmune(ip, value) {
    value = +value;
    return new Promise(async resolve => {
      if(!await this.getIp(ip)) {
        await this.createIpTable(ip, null, null, value);
        return resolve(true);
      }
      this.db.run("UPDATE ips SET restrictImmune = ? WHERE ip = ?", [value, ip], function(err) {
        resolve(!err)
      });
    });
  }
  setMuted(ip, value) {
    value = +value;
    return new Promise(async resolve => {
      if(!await this.getIp(ip)) {
        await this.createIpTable(ip, null, null, null, value);
        return resolve(true);
      }
      this.db.run("UPDATE ips SET muted = ? WHERE ip = ?", [value, ip], function(err) {
        resolve(!err)
      });
    });
  }
  setSelfBanned(ip, value, selfBans) {
    value = +value;
    return new Promise(async resolve => {
      if(!await this.getIp(ip)) {
        await this.createIpTable(ip, value, null, null, selfBans);
        return resolve(true);
      }
      this.db.run("UPDATE ips SET banned = ?, selfBans = ? WHERE ip = ?", [value, selfBans, ip], function(err) {
        resolve(!err)
      });
    });
  }
  getIp(ip) {
    return new Promise(resolve => {
      this.db.get("select * from ips where ip = ?", ip, function(err, row) {
        if(err) {
          console.error(err);
          resolve();
          return;
        }
        if(row) if(row.banned < Date.now() && row.banned !== -1) row.banned = 0;
        
        resolve(row);
      });
    });
  }
  getAllWhitelisted() {
    return new Promise(resolve => {
      this.db.all("SELECT * FROM ips WHERE whitelist = 1", function(err, rows) {
        if(err) {
          console.error(err);
          resolve([]);
          return;
        }
        resolve(rows);
      });
    });
  }
  getAllBanned() {
    return new Promise(resolve => {
      this.db.all("SELECT * FROM ips WHERE (banned = -1 or banned > ?) and banned <> 0", Date.now(), function(err, rows) {
        if(err) {
          console.error(err);
          resolve([]);
          return;
        }
        resolve(rows);
      });
    });
  }
}

module.exports = IpsManager;
