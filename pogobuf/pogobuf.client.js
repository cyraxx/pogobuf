'use strict';

const
    Promise = require('bluebird'),
    EventEmitter = require('events').EventEmitter,
    methods = require('./pogobuf.methods.js'),
    EnvelopeRequest = require('./pogobuf.enveloperequest.js');

const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const DEFAULTOPTIONS = {
    proxy: null,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5,
    maxTries: 5,
    appVersion: '0.33.0',
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
        this.authTicket = null;
    }

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
     * @param {number} [accuracy=0] - The location accuracy in m
     */
    setPosition(latitude, longitude, accuracy = 0) {
        this.playerLatitude = latitude;
        this.playerLongitude = longitude;
        this.playerLocationAccuracy = accuracy;
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
     * @param {string} options.proxy - Sets a proxy address to use for the HTTPS RPC requests.
     * @param {bool} options.mapObjectsThrottling - Enables or disables the
     * built-in throttling of getMapObjects() calls
     * @param {number} options.mapObjectsMinDelay - Minimum delay between getMapObjects() calls
     * @param {number} options.maxTries - Maximum number of times to retry a RPC call when it fails
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
            .getPlayer()
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .call();
    }

    /**
     * Create a batch object which you can add methods to and then do `.call()`
     * @returns {EnvelopeRequest} batch request object
     */
    batch() {
        return new EnvelopeRequest(this);
    }

    /**
     * Takes a EnvelopeRequest instance and sends it
     * @param {EnvelopeRequest} envelopeRequest
     * @returns {promise} Fufills with the decoded result given from RPC call
     */
    sendEnvelopeRequest(envelopeRequest) {
        if (!envelopeRequest instanceof EnvelopeRequest) {
            return Promise.reject(new Error('Missing EnvelopeRequest paramater'));
        }
        // TODO: don't always rebuild
        return envelopeRequest.buildEnvelope({
            latitude: this.playerLatitude,
            longitude: this.playerLongitude,
            accuracy: this.playerLocationAccuracy,
            authTicket: this.authTicket,
            // Required for logging in
            authType: this.authType,
            authToken: this.authToken
        }).then(() => {
            return envelopeRequest.signEnvelope({
                authTicket: this.authTicket
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
            // Handle login redirect
            if (envelope.status_code === 53) {
                this.emit('endpoint-response', {
                    status_code: envelope.status_code,
                    request_id: envelope.request_id.toString(),
                    api_url: envelope.api_url
                });

                this.authTicket = envelope.auth_ticket;
                this.endpoint = `https://${envelope.api_url}/rpc`;
                return this.sendEnvelopeRequest(envelopeRequest);
            }

            // Do required stuff with result
            return responses.length === 1 ? responses[0] : responses;
        }).catch(reason => {
            // Handle the error, retry-logic, etc
            throw reason;
        });
        /*
         * Old get envelope and do request logic
         * TODO: Apply this to the code above
        let getEnvelope;

        if (req._envelope) {
            getEnvelope = Promise.resolve(req._envelope);
        } else {
            let basicEnvelope = this.buildEnvelope(requests);
            getEnvelope = this.signEnvelope(basicEnvelope).then(signedEnvelope => {
                req._envelope = signedEnvelope;
                return signedEnvelope;
            });
        }

        // If needed, delay request for getMapObjects()
        if (req._containsMapCall && this.options.mapObjectsThrottling) {
            let now = new Date().getTime(),
                delayNeeded = this.lastMapObjectsCall
                    + (this.options.mapObjectsMinDelay * 1000) - now;

            if (delayNeeded > 0) {
                console.log('DELAYING MAP REQUEST BY', delayNeeded);
                return Promise.delay(delayNeeded).then(() => this.call(req));
            }
            this.lastMapObjectsCall = now;
        }

        return getEnvelope.then(envelope => this.callRPC(envelope, requests)).catch(reason => {
            if (reason.abort) throw reason;
            if (++req._try >= this.options.retryMax) {
              throw new Error('RPC Call passed retry limit:' + reason);
            }
            let delay = this.options.retryDelay * this.options.retryBackoff * req._try;
            console.log('DELAYING BY ' + delay + ' MS');
            return Promise.delay(delay).then(() => this.call(req));
        });
        */
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
            }
        });
    }
}

module.exports = Client;