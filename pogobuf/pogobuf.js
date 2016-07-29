'use strict';

/**
 * Pogobuf Pokemón Go Client Library.
 * @module pogobuf
 * @namespace
 * @see {@link https://github.com/cyraxx/pogobuf|GitHub repository}
 */
module.exports = {
    Client: require('./pogobuf.client.js'),
    PTCLogin: require('./pogobuf.ptclogin.js'),
    GoogleLogin: require('./pogobuf.googlelogin.js'),
    Utils: require('./pogobuf.utils.js')
};