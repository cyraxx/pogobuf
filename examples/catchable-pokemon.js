'use strict';

const pogobuf = require('pogobuf');
const bluebird = require('bluebird');
const Long = require('long');

var google = new pogobuf.GoogleLogin(),
    client = new pogobuf.Client(),
    lat = 40.780781752363836,
    lng = -73.96390210845829;

var username = '',
    password = '';

google.login(username, password).then(token => {
    client.setAuthInfo('google', token);
    client.setPosition(lat, lng);
    return client.init();
}).then(() => {
    console.log('Authenticated, lets wait for first map reload (30s)');
    setInterval(() => {
        var cellIDs = pogobuf.Utils.getCellIDs(lat, lng);
        return bluebird.resolve(client.getMapObjects(cellIDs, Array(cellIDs.length).fill(0))).then(mapObjects => {
            return mapObjects.map_cells;
        }).each(cell => {
            console.log(new Long(cell.s2_cell_id.low, cell.s2_cell_id.high).toString());
            console.log('Has', cell.catchable_pokemons.length, 'catchable Pokemon');
            return bluebird.resolve(cell.catchable_pokemons).each(catchablePokemon => {
                console.log(' - Pokemon #' +catchablePokemon.pokemon_id + ' is asking you to catch it.' );
            });
        });
    }, 30 * 1000);
});

