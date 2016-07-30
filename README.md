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

# API documentation

## `pogobuf.Client` methods
#### `setAuthInfo(authType, authToken)`
Sets the authentication type and token (required before making API calls).

| Param | Type | Description |
| --- | --- | --- |
| authType | <code>string</code> | Authentication provider type (`ptc` or `google`) |
| authToken | <code>string</code> | Authentication token received from authentication provider |

#### `setPosition(latitude, longitude)`
Sets the player's latitude and longitude.
Note that this does not actually update the player location on the server, it only sets
the location to be used in following API calls. To update the location on the server you
probably want to call `updatePlayer`.

| Param | Type | Description |
| --- | --- | --- |
| latitude | <code>number</code> | The player's latitude |
| longitude | <code>number</code> | The player's longitude |

#### `init()` ⇒ <code>Promise</code>
Performs the initial API call.

#### `batchStart()` ⇒ <code>Client</code>
Sets batch mode. All further API requests will be held and executed in one RPC call when `batchCall` is called.

#### `batchClear()`
Clears the list of batched requests and aborts batch mode.

#### `batchCall()` ⇒ <code>Promise</code>
Executes any batched requests.

#### `setMaxTries(maxTries)`
Sets the maximum times to try RPC calls until they succeed (default is 5 tries). Set to 1 to disable retry logic.

| Param | Type |
| --- | --- |
| maxTries | <code>integer</code> |

## `pogobuf.Client` Pokémon Go API methods
#### `addFortModifier(modifierItemID, fortID)` ⇒ <code>Promise</code>
#### `attackGym(gymID, battleID, attackActions, lastRetrievedAction)` ⇒ <code>Promise</code>
#### `catchPokemon(encounterID, pokeballItemID, normalizedReticleSize, spawnPointID, hitPokemon, spinModifier, normalizedHitPosition)` ⇒ <code>Promise</code>
#### `checkAwardedBadges()` ⇒ <code>Promise</code>
#### `checkCodenameAvailable(codename)` ⇒ <code>Promise</code>
#### `claimCodename(codename)` ⇒ <code>Promise</code>
#### `collectDailyBonus()` ⇒ <code>Promise</code>
#### `collectDailyDefenderBonus()` ⇒ <code>Promise</code>
#### `diskEncounter(encounterID, fortID)` ⇒ <code>Promise</code>
#### `downloadItemTemplates()` ⇒ <code>Promise</code>
#### `downloadRemoteConfigVersion(platform, deviceManufacturer, deviceModel, locale, appVersion)` ⇒ <code>Promise</code>
#### `downloadSettings(hash)` ⇒ <code>Promise</code>
#### `echo()` ⇒ <code>Promise</code>
#### `encounter(encounterID, spawnPointID)` ⇒ <code>Promise</code>
#### `encounterTutorialComplete(pokemonID)` ⇒ <code>Promise</code>
#### `equipBadge(badgeType)` ⇒ <code>Promise</code>
#### `evolvePokemon(pokemonID)` ⇒ <code>Promise</code>
#### `fortDeployPokemon(fortID, pokemonID)` ⇒ <code>Promise</code>
#### `fortDetails(fortID, fortLatitude, fortLongitude)` ⇒ <code>Promise</code>
#### `fortRecallPokemon(fortID, pokemonID)` ⇒ <code>Promise</code>
#### `fortSearch(fortID, fortLatitude, fortLongitude)` ⇒ <code>Promise</code>
#### `getAssetDigest(platform, deviceManufacturer, deviceModel, locale, appVersion)` ⇒ <code>Promise</code>
#### `getDownloadURLs(assetIDs)` ⇒ <code>Promise</code>
#### `getGymDetails(gymID, gymLatitude, gymLongitude)` ⇒ <code>Promise</code>
#### `getHatchedEggs()` ⇒ <code>Promise</code>
#### `getIncensePokemon()` ⇒ <code>Promise</code>
#### `getInventory(lastTimestamp)` ⇒ <code>Promise</code>
#### `getMapObjects(cellIDs, sinceTimestamps)` ⇒ <code>Promise</code>
#### `getPlayer()` ⇒ <code>Promise</code>
#### `getPlayerProfile(playerName)` ⇒ <code>Promise</code>
#### `getSuggestedCodenames()` ⇒ <code>Promise</code>
#### `incenseEncounter(encounterID, encounterLocation)` ⇒ <code>Promise</code>
#### `levelUpRewards(level)` ⇒ <code>Promise</code>
#### `markTutorialComplete(tutorialsCompleted, sendMarketingEmails, sendPushNotifications)` ⇒ <code>Promise</code>
#### `nicknamePokemon(pokemonID, nickname)` ⇒ <code>Promise</code>
#### `playerUpdate()` ⇒ <code>Promise</code>
#### `recycleInventoryItem(itemID, count)` ⇒ <code>Promise</code>
#### `releasePokemon(pokemonID)` ⇒ <code>Promise</code>
#### `setAvatar(skin, hair, shirt, pants, hat, shoes, gender, eyes, backpack)` ⇒ <code>Promise</code>
#### `setContactSettings(sendMarketingEmails, sendPushNotifications)` ⇒ <code>Promise</code>
#### `setFavoritePokemon(pokemonID, isFavorite)` ⇒ <code>Promise</code>
#### `setPlayerTeam(teamColor)` ⇒ <code>Promise</code>
#### `sfidaActionLog()` ⇒ <code>Promise</code>
#### `startGymBattle(gymID, attackingPokemonIDs, defendingPokemonID)` ⇒ <code>Promise</code>
#### `upgradePokemon(pokemonID)` ⇒ <code>Promise</code>
#### `useIncense(itemID)` ⇒ <code>Promise</code>
#### `useItemCapture(itemID, encounterID, spawnPointID)` ⇒ <code>Promise</code>
#### `useItemEggIncubator(itemID, pokemonID)` ⇒ <code>Promise</code>
#### `useItemGym(itemID, gymID)` ⇒ <code>Promise</code>
#### `useItemPotion(itemID, pokemonID)` ⇒ <code>Promise</code>
#### `useItemRevive(itemID, pokemonID)` ⇒ <code>Promise</code>
#### `useItemXPBoost(itemID)` ⇒ <code>Promise</code>

## `pogobuf.Client` Events
The `Client` class is an [`EventEmitter`](https://nodejs.org/api/events.html) that emits the following events
(mostly for debugging purposes):

#### `request(requestData)`
Fires while building a RPC request envelope with subrequests.

Example `requestData` structure:
```javascript
{
    request_id: 8145806132888207000,
    requests: [
        {
            name: 'Get Inventory',
            type: 4,
            data: {
                last_timestamp_ms: 0
            }
        }
    ]
}
```

#### `raw-request(envelopeData)`
Fires after building an RPC request envelope, just before it is encoded into a protobuf `RequestEnvelope`.

#### `response(responseData)`
Fires after receiving and successfully decoding an RPC request, just before the Promise is resolved.

Example `responseData` structure:
```javascript
{
    status_code: 1,
    request_id: '8145806132888207360',
    responses: [
        {
            name: 'Get Inventory',
            type: 4,
            data: {
                /* inventory data */
            }
        }
    ]
}
```

#### `endpoint-response(responseData)`
Fires after the initial RPC response (including the URL of the endpoint to use for all further requests)
has been received and decoded.

Example `responeData` structure:
```javascript
{
    status_code: 53,
    request_id: '8145806132888207360',
    api_url: 'pgorelease.nianticlabs.com/plfe/403'
}
```

#### `raw-response(responseEnvelope)`
Fires when a RPC `ResponseEnvelope` has been received, just after it has been decoded.

#### `parse-envelope-error(rawEnvelopeBuffer, error)`
Fires when the `RequestEnvelope` structure could not be parsed (possibly due to erroneous .proto files).
Can be used to dump out the raw protobuf response and debug using `protoc`.

#### `parse-response-error(rawResponseBuffer, error)`
Fires when one of the response messages received in an RPC response envelope could not be parsed (possibly
due to erroneous .proto files). Can be used to dump out the raw protobuf response and debug using `protoc`.

## `pogobuf.GoogleLogin` methods
#### `login(username, password)` ⇒ <code>Promise</code>
Performs the Google login process and returns a Promise that will be resolved with the
auth token.

| Param | Type |
| --- | --- |
| username | <code>string</code> |
| password | <code>string</code> |

## `pogobuf.PTCLogin` methods
#### `login(username, password)` ⇒ <code>Promise</code>
Performs the PTC login process and returns a Promise that will be resolved with the
auth token.

| Param | Type |
| --- | --- |
| username | <code>string</code> |
| password | <code>string</code> |

## `pogobuf.Utils` methods
### `splitInventory(inventory)` ⇒ <code>object</code> *(static)*
Takes a `getInventory()` response and separates it into pokemon, items, candies, player
data, eggs, and pokedex.

| Param | Type | Description |
| --- | --- | --- |
| inventory | <code>object</code> | API response message as returned by `getInventory()` |

### `splitItemTemplates(templates)` ⇒ <code>object</code> *(static)*
Takes a `downloadItemTemplates()` response and separates it into the individual settings
objects.
data, eggs, and pokedex.

| Param | Type | Description |
| --- | --- | --- |
| templates | <code>object</code> | API response message as returned by `downloadItemTemplates()` |

### `getEnumKeyByValue(enumObj, val)` ⇒ <code>string</code> *(static)*
Utility method that finds the name of the key for a given enum value and makes it
look a little nicer.

| Param | Type |
| --- | --- |
| enumObj | <code>object</code> |
| val | <code>number</code> |

### `getIVsFromPokemon(pokemon)` ⇒ <code>object</code> *(static)*
Utility method to get the Individual Values from Pokémon

| Param | Type | Description |
| --- | --- | --- |
| pokemon | <code>object</code> | A `pokemon_data` structure |
