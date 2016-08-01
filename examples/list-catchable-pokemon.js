'use strict';

/*
    This example script repeatedly queries the area near the given coordinates for catchable Pokémon.
*/

const pogobuf = require('pogobuf'),
    POGOProtos = require('node-pogo-protos'),
    bluebird = require('bluebird'),
    Long = require('long');

const google = new pogobuf.GoogleLogin(),
    client = new pogobuf.Client();

// Note: To avoid getting softbanned, change these coordinates to something close to where you last used your account
const lat = 37.7876146,
    lng = -122.3884353;

var username = 'your-google-username',
    password = 'your-google-password';

google.login(username, password).then(token => {
    client.setAuthInfo('google', token);
    client.setPosition(lat, lng);
    return client.init();
}).then(() => {
    console.log('Authenticated, waiting for first map refresh (30s)');
    setInterval(() => {
        var cellIDs = pogobuf.Utils.getCellIDs(lat, lng);
        return bluebird.resolve(client.getMapObjects(cellIDs, Array(cellIDs.length).fill(0))).then(mapObjects => {
            return mapObjects.map_cells;
        }).each(cell => {
            console.log('Cell ' + cell.s2_cell_id.toString());
            console.log('Has ' + cell.catchable_pokemons.length + ' catchable Pokemon');
            return bluebird.resolve(cell.catchable_pokemons).each(catchablePokemon => {
                console.log(' - A ' + pogobuf.Utils.getEnumKeyByValue(POGOProtos.Enums.PokemonId,
                    catchablePokemon.pokemon_id) + ' is asking you to catch it.');
            });
        });
    }, 30 * 1000);
});