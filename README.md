# The project is abonded
# I'm not proud of this server
1. It is all in one file
2. Docs are not finished
3. The chunks manager is old. If someone would write another owop server in js or in any other language use jpg instead of weird chunks

# owop-server
This server was created by FP#9390 (FunPoster or system2k), felpcereti#9857 (mathias377), dimden#1877\
dimden's discord: [k4u7ddk](https://discord.gg/k4u7ddk)\
mathias377's discord: sus\
\
\
*Example:*
```js
const Server = require("owop-server");

let server = new Server({
	//options
})
```

# Options:
*Server uses captcha v2*\
*tip: You can whitelist an ip address using /whitelist add ip command*

## Server
`adminlogin` (required) - admin login\
`modlogin` (required) - mod login\
`defaultPQuota` (default [64, 4]) - default all worlds pquota *tip: you can change it for only one world using /setprop pquota 64,4*\
`maxClientsPerIp` (default 3) - max connections from one ip\
`maxClientsOnWorld` (default 50) - max clients on world (akka maxcount)\
`maxClientsOnServer` (default 500) - max connections on server\
`appealLink` (default mathias377's discord or dimden's discord) - Appeal for unban link

## Captcha
`captchaBypass` (not required if blank, it automatically generates random string) - password which allows to bypass captcha (useful for bots)\
`captchaKey` (required if you want to use captcha) - private captcha key\
`captchaSecurity` (0 is default and means that captcha is disabled) - captchaSecurity has 3 modes:\
`mode 0` - captcha is disabled\
`mode 1` - captcha is enabled and shows only once per server run\
`mode 2` - captcha is enabled and shows always

## Database
`databasePath` (default database.db) - database file location\
`chunksUpdateRate` (default 5 minutes 1000 * 60 * 5) - chunks/worlds saving interval\
`chunkdataPath` (default "chunkdata") - folder where chunk data will be saved

## Anti proxy
`antiProxyApiKey` (not required if you don't want use anti proxy) - http://proxycheck.io/ api key\
`antiProxyEnabled` (default if antiProxyKey exist) - Is anti proxy enabled

# Events
name - description [callback]

`open` - Emitted when user connected to server but it's before verification. [user]\
`join` - Emitted when user is after verification (joined world). [user]\
`close` - Emitted when user got disconnected. [user] \
*Tip: To check if user joined to world use `if(user.world)`*\
\
`setPixel` - Emitted when user set an pixel. [user, x, y, [r, g, b]]\
`playerUpdate` - Emitted when the user has updated. [user]\
`setChunk` - Emitted when user set chunk(in owop protocol clearChunk). [user, x, y, [r, g, b]]\
`protectChunk` - Emits when user protected an chunk. [user, x, y, newState]\
`paste` - Emitted when user paste an chunk. [user, x, y, chunkData] *chunkData length is 16 \* 16 \* 3*\
`requestChunk` - Emitted when user requests an chunk. [user, x, y]\
\
`setRank` - Emitted when server set user rank. [user]\
`maxCount` - Emitted when user got rank admin or moderator. Max count means max count of players on world. [user]\
`setPQuota` - Emitted when server set pixel quota for user. [user]\
`setId` - Emitted when server set id for user. [user]\
`sentData` - Emitted when server sent data to user. [user, data]\
`teleport` - Emitted when user has been teleported. [user]\
\
`rawMessage` - Emitted when user sent an message. [user, message]\
`captcha` - Emitted when user sent captcha token to server. [user]\
`rankVerification` - Emitted when client sends it's rank (idk why this even exists). [user, rankToVerify]\
\
`savedWorlds` - Emitted when server saved worlds/chunks. []\
`exiting` - server is exiting. []\


# Coding

## player class
```js
user.muted; // returns is player is muted
user.id; // returns id
user.ip; // returns ip of player
user.id; // returns id
user.rank; // returns rank of client
user.x; user.y // returns x/y
user.realX; user.realY; // returns realX/realY diffrent in it is that it's divided by 16
user.pquota; user.cquota; // returns pixelquota/chatquota Bucket object
user.r; user.g; user.b; // returns r/g/b
user.stealth; // returns stealth (if true (A) or (M) is removed and it looks like player)
user.nick; // retruns nick of user
user.world; // returns user's world
user.ws; // returns user websocket
user.req; // returns user req
user.captcha; //returns user captcha
user.before; // returns user's before example: [id] nick

user.setRank(rank); // sets user rank; all things like pquota/cquota/helpmessage is sent automatically

user.setMaxCount(server.maxClientsOnWorld); // sets maxcount thing ??????????
user.setPQuota(rate, per); // sets pixel quota

user.setId(id); // sets id client
user.send(data); // sends data to client like user.ws.send() but in try
user.teleport(x, y); // teleports user to x and y
```


## server.utils
Utilities\
\
**name (optionally args) - description**\

`random` ([number] min, [number] max) - Function which gets random number betwen min and max
`randomString` ([number] length) - Generates random string

`sendToAll` ([something to send] data, [string] requiredRank (default 0, to get it), [string] world (if you will include it then it will send message only to one world)) - Sends an data to all players on server/world

`compress` ([Uint8Array] chunkData, [number] x, [number] y, [boolean] isProtected) - Compresses chunkData, x, y, isProtected to Uint8Array
example:
```js
let chunkData = new Uint8Array(16 * 16 * 3); // It's full of 0 so it's black chunk; one pixel = 3 places in it

for(let i = 0; i < 16 * 16 * 3; i++) chunkData[i] = 255; // Changes it to blank array

user.send(server.utils.compress(chunkData, 0, 0, false)); // Sends unprotected blank chunk on 0, 0 but it won't be saved into database without \/

server.manager.setChunk(user.world.name, 0, 0, chunkData); // sets chunk in database
```

`world` ([string] name, [string] modlogin, [string] pass, [string] pquota, [string] motd, [boolean] restricted) - it's class of world

`UpdateClock` () - It's class of UpdateClock

`captcha` ([player class] user) - it's captcha class used in user for sending captcha things you can read more in code

`outsideWorldBorder` ([number] x, [number] y, [boolean] raw = true) - Checks is chunkX and chunkY is outside borders `Math.pow(2, 24)/16 === 1048576`

`player` ([ws] ws, [req] req) - player class

`Bucket` ([number] rate, [number] per) - Normal bucket which player uses

`distance` ([number] x1, [number] y1, [number] x2, [number] y2) - Measures distance betwen x1, y1, x2, y2

`getAllPlayers` () - Returns all players on server

`getAllPlayersWithIp` ([string] ip) - Returns all players with ip on server

## Server variables

`protocol` - protocol of server

`utils` - utils of server

`wss` - WebSocket server of client

`worldBorder` - after that value requested chunks wont be sent to client; Math.pow(2, 24)/16 === 1048576

`updateInterval` - server updates interval like player updates/disconnections/pixel updates
