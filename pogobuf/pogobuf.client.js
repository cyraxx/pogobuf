'use strict';

const
    crypto = require('crypto'),
    EventEmitter = require('events').EventEmitter,
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    pogoSignature = require('node-pogo-signature'),
    Promise = require('bluebird'),
    request = require('request'),
    retry = require('bluebird-retry'),
    Utils = require('./pogobuf.utils.js'),
    methods = require('./pogobuf.methods.js');

const RequestType = POGOProtos.Networking.Requests.RequestType;
const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const DEFAULTOPTIONS = {
    proxy: null,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5,
    maxTries: 5,
};

/**
 * Pokémon Go RPC client.
 * @class Client
 * @memberof pogobuf
 */
class Client extends EventEmitter {

    constructor() {
        super();
        this.authType = null;
        this.authToken = null;
        this.batchRequests = false;
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
        this.signatureBuilder = new pogoSignature.Builder();
        this.lastMapObjectsCall = 0;
        // request default
        this.rpcRequest = request.defaults({
            headers: {
                'User-Agent': 'Niantic App',
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            encoding: null
        });

        /*
            The response to the first RPC call does not contain any response messages even though
            the envelope includes requests, technically it wouldn't be necessary to send the
            requests but the app does the same. The call will then automatically be resent to the
            new API endpoint by callRPC().
        */
        return this.batch()
            .getPlayer('0.31.1')
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .send()
            .then(this.processInitialData.bind(this));
    }

    /**
     * Create a batch call
     * @returns {object} batch request object
     */
    batch() {
        let self = this;
        let req = {
            requests: [],
            send: function() {
                return self.callRPC(this.requests);
            }
        };
        for (let method in methods) {
            if (methods.hasOwnProperty(method)) {
                Object.defineProperty(req, method, {
                    enumerable: true,
                    value: function(...args) {
                        this.requests.push(self.makeRequest(method, ...args));
                        return this;
                    }
                });
            }
        }
        return req;
    }

    /**
     * Sets batch mode. All further API requests will be held and executed in one RPC call when
     * {@link #batchCall} is called.
     * @return {Client} this
     */
    batchStart() {
        if (!this.batchRequests) {
            this.batchRequests = [];
        }
        return this;
    }

    /**
     * Clears the list of batched requests and aborts batch mode.
     */
    batchClear() {
        this.batchRequests = false;
    }

    /**
     * Executes any batched requests.
     * @return {Promise}
     */
    batchCall() {
        if (!this.batchRequests || this.batchRequests.length === 0) {
            return Promise.resolve(false);
        }

        let p = this.callRPC(this.batchRequests);

        this.batchClear();
        return p;
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

    makeRequest(req, ...args) {
        if (methods.hasOwnProperty(req)) {
            return methods[req].call(this, ...args);
        }
        throw Error(`Method ${req} does not exist`);
    }

    /**
     * Generates a random request ID
     * @private
     * @return {Long}
     */
    getRequestID() {
        var bytes = crypto.randomBytes(8);
        return Long.fromBits(
            bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
            bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
            true
        );
    }

    /**
     * Creates an RPC envelope with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @return {POGOProtos.Networking.Envelopes.RequestEnvelope}
     */
    buildEnvelope(requests) {
        var envelopeData = {
            status_code: 2,
            request_id: this.getRequestID(),
            unknown12: 989
        };

        if (this.playerLatitude) envelopeData.latitude = this.playerLatitude;
        if (this.playerLongitude) envelopeData.longitude = this.playerLongitude;
        if (this.playerAltitude) envelopeData.altitude = this.playerAltitude;

        if (this.authTicket) {
            envelopeData.auth_ticket = this.authTicket;
        } else if (!this.authType || !this.authToken) {
            throw Error('No auth info provided');
        } else {
            envelopeData.auth_info = {
                provider: this.authType,
                token: {
                    contents: this.authToken,
                    unknown2: 59
                }
            };
        }

        if (requests) {
            this.emit('request', {
                request_id: envelopeData.request_id.toString(),
                requests: requests.map(r => ({
                    name: Utils.getEnumKeyByValue(RequestType, r.type),
                    type: r.type,
                    data: r.message
                }))
            });

            envelopeData.requests = requests.map(r => {
                var requestData = {
                    request_type: r.type
                };

                if (r.message) {
                    requestData.request_message = r.message.encode();
                }

                return requestData;
            });
        }

        this.emit('raw-request', envelopeData);

        return new POGOProtos.Networking.Envelopes.RequestEnvelope(envelopeData);
    }

    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    buildSignedEnvelope(requests, envelope) {
        return new Promise((resolve, reject) => {
            if (!envelope) {
                try {
                    envelope = this.buildEnvelope(requests);
                } catch (e) {
                    reject(new retry.StopError(e));
                }
            }

            if (!envelope.auth_ticket) {
                // Can't sign before we have received an auth ticket
                resolve(envelope);
                return;
            }

            this.signatureBuilder.setAuthTicket(envelope.auth_ticket);
            this.signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.altitude);

            this.signatureBuilder.encrypt(envelope.requests, (err, sigEncrypted) => {
                if (err) {
                    reject(new retry.StopError(err));
                    return;
                }

                envelope.unknown6.push(new POGOProtos.Networking.Envelopes.Unknown6({
                    request_type: 6,
                    unknown2: new POGOProtos.Networking.Envelopes.Unknown6.Unknown2({
                        encrypted_signature: sigEncrypted
                    })
                }));

                resolve(envelope);
            });
        });
    }

    /**
     * Executes an RPC call with the given list of requests, retrying if necessary.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    callRPC(requests, envelope) {
        // If the requests include a map objects request, make sure the minimum delay
        // since the last call has passed
        if (requests.some(r => r.type === RequestType.GET_MAP_OBJECTS)) {
            var now = new Date().getTime(),
                delayNeeded = this.lastMapObjectsCall + (this.options.mapObjectsMinDelay * 1000) - now;

            if (delayNeeded > 0 && this.options.mapObjectsThrottling) {
                return Promise.delay(delayNeeded).then(() => this.callRPC(requests, envelope));
            }

            this.lastMapObjectsCall = now;
        }

        if (this.options.maxTries <= 1) return this.tryCallRPC(requests, envelope);

        return retry(() => this.tryCallRPC(requests, envelope), {
            interval: 300,
            backoff: 2,
            max_tries: this.options.maxTries
        });
    }

    /**
     * Executes an RPC call with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    tryCallRPC(requests, envelope) {
        return this.buildSignedEnvelope(requests, envelope)
            .then(signedEnvelope => new Promise((resolve, reject) => {
                this.rpcRequest({
                    method: 'POST',
                    url: this.endpoint,
                    proxy: this.proxy,
                    body: signedEnvelope.toBuffer()
                }, (err, response, body) => {
                    if (err) {
                        reject(Error(err));
                        return;
                    }

                    if (response.statusCode !== 200) {
                        if (response.statusCode >= 400 && response.statusCode < 500) {
                            /* These are permanent errors so throw StopError */
                            reject(new retry.StopError(
                                `Status code ${response.statusCode} received from HTTPS request`));
                        } else {
                            /* Anything else might be recoverable so throw regular Error */
                            reject(Error(`Status code ${response.statusCode} received from HTTPS request`));
                        }
                        return;
                    }

                    var responseEnvelope;
                    try {
                        responseEnvelope = POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(body);
                    } catch (e) {
                        this.emit('parse-envelope-error', body, e);
                        if (e.decoded) {
                            responseEnvelope = e.decoded;
                        } else {
                            reject(new retry.StopError(e));
                            return;
                        }
                    }

                    this.emit('raw-response', responseEnvelope);

                    if (responseEnvelope.error) {
                        reject(new retry.StopError(responseEnvelope.error));
                        return;
                    }

                    if (responseEnvelope.auth_ticket) this.authTicket = responseEnvelope.auth_ticket;

                    if (this.endpoint === INITIAL_ENDPOINT) {
                        /* status_code 102 seems to be invalid auth token,
                           could use later when caching token. */
                        if (responseEnvelope.status_code !== 53) {
                            reject(Error('Fetching RPC endpoint failed, received status code ' +
                                responseEnvelope.status_code));
                            return;
                        }

                        if (!responseEnvelope.api_url) {
                            reject(Error('Fetching RPC endpoint failed, none supplied in response'));
                            return;
                        }

                        this.endpoint = 'https://' + responseEnvelope.api_url + '/rpc';

                        this.emit('endpoint-response', {
                            status_code: responseEnvelope.status_code,
                            request_id: responseEnvelope.request_id.toString(),
                            api_url: responseEnvelope.api_url
                        });

                        resolve(this.callRPC(requests, envelope));
                        return;
                    }

                    /* These codes indicate invalid input, no use in retrying so throw StopError */
                    if (responseEnvelope.status_code === 3 || responseEnvelope.status_code === 102) {
                        reject(new retry.StopError(
                            `Status code ${responseEnvelope.status_code} received from RPC`));
                    }

                    /* These can be temporary so throw regular Error */
                    if (responseEnvelope.status_code !== 2 && responseEnvelope.status_code !== 1) {
                        reject(Error(`Status code ${responseEnvelope.status_code} received from RPC`));
                        return;
                    }

                    var responses = [];

                    if (requests) {
                        if (requests.length !== responseEnvelope.returns.length) {
                            reject(Error('Request count does not match response count'));
                            return;
                        }

                        for (var i = 0; i < responseEnvelope.returns.length; i++) {
                            if (!requests[i].responseType) continue;

                            var responseMessage;
                            try {
                                responseMessage = requests[i].responseType.decode(responseEnvelope.returns[
                                    i]);
                            } catch (e) {
                                this.emit('parse-response-error', responseEnvelope.returns[i].toBuffer(), e);
                                reject(new retry.StopError(e));
                                return;
                            }

                            responses.push(responseMessage);
                        }
                    }

                    this.emit('response', {
                        status_code: responseEnvelope.status_code,
                        request_id: responseEnvelope.request_id.toString(),
                        responses: responses.map((r, h) => ({
                            name: Utils.getEnumKeyByValue(RequestType, requests[h].type),
                            type: requests[h].type,
                            data: r
                        }))
                    });

                    if (!responses.length) resolve(true);
                    else if (responses.length === 1) resolve(responses[0]);
                    else resolve(responses);
                });
            }));
    }

    /**
     * Processes the data received from the initial API call during init().
     * @private
     * @param {Object[]} responses - Respones from API call
     * @return {Object[]} respones - Unomdified responses (to send back to Promise)
     */
    processInitialData(responses) {
        // Extract the minimum delay of getMapObjects()
        if (responses.length >= 5) {
            var settingsResponse = responses[4];
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
                return this.callRPC([this.makeRequest(method, ...args)]);
            }
        });
        Object.defineProperty(Client.prototype, (method + 'Raw'), {
            value: function(...args) {
                return this.makeRequest(method, ...args);
            }
        });
    }
}

module.exports = Client;
