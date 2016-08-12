'use strict';

const
    crypto = require('crypto'),
    EventEmitter = require('events').EventEmitter,
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    Promise = require('bluebird'),
    Utils = require('./pogobuf.utils.js'),
    methods = require('./pogobuf.methods.js'),
    EnvelopeRequest = require('./pogobuf.enveloperequest.js');

const RequestType = POGOProtos.Networking.Requests.RequestType;
const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const DEFAULTOPTIONS = {
    proxy: null,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5,
    maxTries: 5,
    appVersion: '0.31.1',
    autoRetry: true,
    retryDelay: 500,
    retryBackoff: 2,
    retryMax: 5
};

/**
 * Pokémon Go RPC client.
 * @class Client
 * @memberof pogobuf
 */
class Client extends EventEmitter {

    constructor() {
        super();
    }

    /**
     * PUBLIC METHODS
     */

    /**
     * Sets the authentication type and token (required before making API calls).
     * @param {string} authType - Authentication provider type (ptc or google)
     * @param {string} authToken - Authentication token received from authentication provider
     */
    setAuthInfo(authType, authToken) {
        this.authType = authType;
        this.authToken = authToken;
    }

    /**
     * Sets the player's latitude and longitude.
     * Note that this does not actually update the player location on the server, it only sets
     * the location to be used in following API calls. To update the location on the server you
     * probably want to call {@link #updatePlayer}.
     * @param {number} latitude - The player's latitude
     * @param {number} longitude - The player's longitude
     * @param {number} [altitude=0] - The player's altitude
     */
    setPosition(latitude, longitude, altitude = 0) {
        this.playerLatitude = latitude;
        this.playerLongitude = longitude;
        this.playerAltitude = altitude;
    }
    
    /**
     * Change a option in the client, see init for more info
     * @param {string} key - The name of the option
     * @param {mixed} val - The new value of the option
     */
    setOption(key, val) {
        if (this.options.hasOwnProperty(key)) {
            this.options[key] = val;
        }
    }

    /**
     * Performs the initial API call.
     * @param {object} options - Set options for the client
     * @param {string} object.proxy - Sets a proxy address to use for the HTTPS RPC requests.
     * @param {bool} object.mapObjectsThrottling - Enables or disables the
     * built-in throttling of getMapObjects() calls
     * @param {number} object.mapObjectsMinDelay - Minimum delay between getMapObjects() calls
     * @param {number} object.maxTries - Maximum number of times to retry a RPC call when it fails
     * @return {Promise} promise
     */
    init(options = {}) {
        this.options = Object.assign({}, DEFAULTOPTIONS, options);
        // Internal values
        this.endpoint = INITIAL_ENDPOINT;
        this.lastMapObjectsCall = 0;

        /*
            The response to the first RPC call does not contain any response messages even though
            the envelope includes requests, technically it wouldn't be necessary to send the
            requests but the app does the same. The call will then automatically be resent to the
            new API endpoint by callRPC().
        */
        return this.batch()
            .getPlayer(this.options.appVersion)
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .call();
    }

    /**
     * Create a batch call
     * @returns {object} batch request object
     */
    batch() {
        return new EnvelopeRequest(this);
    }
    
    /**
     * Takes a EnvelopeRequest instance and sends it
     * @returns {object} batch request object
     */
    sendEnvelopeRequest(envelopeRequest) {
        // TODO: don't always rebuild
        return envelopeRequest.buildEnvelope({
            latitude: this.playerLatitude,
            longitude: this.playerLongitude,
            altitude: this.playerAltitude
        }).then(() => {
            return envelopeRequest.signEnvelope({
                auth_ticket: this.auth_ticket
            });
        }).then(() => {
            envelopeRequest.try++;
            return envelopeRequest.send({
                endpoint: this.endpoint,
                proxy: this.options.proxy
            });
        }).then(body => {
            return envelopeRequest.decode(body);
        }).spread((responses, envelope) => {
            // Handle redirect
            if (envelope.status_code === 53) {
                this.auth_ticket = envelope.auth_ticket;
                this.endpoint = envelope.api_url;
            }
            // Do required stuff with result
            return responses.length === 1 ? responses[0] : responses;
        }).catch(reason => {
            // Handle the error, retry-logic, etc
            console.log(reason);
        });
    }

    /**
     * Processes the data received from the initial API call during init().
     * @private
     * @param {Object[]} responses - Respones from API call
     * @return {Object[]} respones - Unomdified responses (to send back to Promise)
     */
    processInitialData(responses) {
        // TODO: apply this to every result
        // Extract the minimum delay of getMapObjects()
        if (responses.length >= 5) {
            let settingsResponse = responses[4];
            if (!settingsResponse.error &&
                settingsResponse.settings &&
                settingsResponse.settings.map_settings &&
                settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
            ) {
                this.setOption(
                  'mapObjectsMinDelay',
                  settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
                );
            }
        }
        return responses;
    }
}

for (let method in methods) {
    if (methods.hasOwnProperty(method)) {
        Object.defineProperty(Client.prototype, method, {
            value: function(...args) {
                let batch = this.batch();
                batch[method](...args);
                return batch.call();
                // return this.callRPC([this.makeRequest(method, ...args)]);
            }
        });
    }
}

module.exports = Client;
