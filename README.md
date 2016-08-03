# pogobuf, a Pokémon Go Client Library for node.js
[![npm version](https://badge.fury.io/js/pogobuf.svg)](https://badge.fury.io/js/pogobuf)
![npm downloads](https://img.shields.io/npm/dt/pogobuf.svg)
![dependencies](https://david-dm.org/cyraxx/pogobuf.svg)
![license](https://img.shields.io/npm/l/pogobuf.svg)

## Features
* Implements all known Pokémon Go API calls
* Uses ES6 Promises and [Bluebird](https://github.com/petkaantonov/bluebird/)
* Includes [Pokémon Trainer Club](https://www.pokemon.com/en/pokemon-trainer-club) and Google login clients
* Optional batch mode to group several requests in one RPC call
* Automatically retries failed API requests with increasing delay

## Acknowledgements
* Uses the excellent [POGOProtos](https://github.com/AeonLucid/POGOProtos) (via [node-pogo-protos](https://github.com/cyraxx/node-pogo-protos))
* Based on prior work by [tejado](https://github.com/tejado/pgoapi) and others

## Usage
### Installation
`npm install pogobuf --save`

### Basic Usage
Generally, every method that makes an API call returns an ES6 Promise that will be resolved with the response message object (or `true` if there was no response message).

Before using a `pogobuf.Client` instance to make API calls you need to supply it with an auth token (which you can get from the `pogobuf.PTCLogin` or `pogobuf.GoogleLogin` class) and call `init()` to make an initial request.

Example usage with PTC login:

```javascript
const pogobuf = require('pogobuf');

var login = new pogobuf.PTCLogin(),
    client = new pogobuf.Client();

login.login('username', 'password')
.then(token => {
    client.setAuthInfo('ptc', token);
    client.setPosition(lat, lng);
    return client.init();
}).then(() => {
    // Make some API calls!
    return client.getInventory(0);
}).then(inventory => {
    // Use the returned data
});
```

Example usage with Google login:

```javascript
const pogobuf = require('pogobuf');

var login = new pogobuf.GoogleLogin(),
    client = new pogobuf.Client();

login.login('username', 'password')
.then(token => {
    client.setAuthInfo('google', token);
    client.setPosition(lat, lng);
    return client.init();
}).then(() => {
    // Make some API calls!
    return client.getInventory(0);
}).then(inventory => {
    // Use the returned data
});
```

For more details, see the API documentation below or [the example scripts](https://github.com/cyraxx/pogobuf/blob/master/examples).

### Batch mode
The Pokémon Go API offers the ability to send multiple requests in one call. To do this you can use pogobuf's batch mode:

First call `batchStart()` to enable batch mode. When in batch mode, all API request methods will append the request to the current batch instead of immediately sending it to the server. Once you have all your requests, call `batchCall()` which submits them to the server, disables batch mode, and returns a Promise that will be resolved with an array of response messages corresponding to your requests.

When in batch mode, all API request methods (as well as `batchStart()`) return the `Client` instance so you can chain them.

Example batch usage:

```javascript
client.batchStart()
    .getPlayer()
    .getHatchedEggs()
    .getInventory(0)
    .batchCall()
    .then(responses => {
        // responses is: [GetPlayerResponse, GetHatchedEggsResponse, GetInventoryResponse]
    });
```

# Documentation
You can find the documentation in the [wiki](https://github.com/cyraxx/pogobuf/wiki).
